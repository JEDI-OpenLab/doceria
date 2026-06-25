// Couche réseau native ILaaS (API compatible OpenAI).
//
// Tout le trafic part du Rust (reqwest) : pas de CORS, et la clé est ajoutée à
// l'en-tête `Authorization` côté natif — elle ne transite jamais par le webview
// au-delà de l'`invoke`. (Phase 2 : la clé sera lue depuis le trousseau OS.)
//
// - `list_models` : GET /models
// - `chat`        : POST /chat/completions en streaming SSE → events `chat://delta`,
//                   renvoie le texte complet + l'objet `usage` à la fin.
// - `cancel_chat` : déclenche le « Stop » (annule le chat en cours).

use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Notify;

use crate::settings::{self, SettingsState};

/// État partagé : jeton d'annulation (`Notify`) du chat en cours.
#[derive(Default)]
pub struct ChatState {
    cancel: Mutex<Option<Arc<Notify>>>,
}

/// Garde RAII : remet `state.cancel` à None à la sortie de `chat()` (succès, erreur
/// ou abort), mais seulement si le jeton stocké est TOUJOURS le sien — `Arc::ptr_eq`
/// évite d'effacer le jeton d'un échange concurrent qui aurait déjà pris la place.
/// Maintient l'invariant « cancel non-None ⟺ un chat est en cours ».
struct CancelGuard<'a> {
    state: &'a ChatState,
    notify: Arc<Notify>,
}

impl Drop for CancelGuard<'_> {
    fn drop(&mut self) {
        let mut slot = self.state.cancel.lock().unwrap();
        if slot.as_ref().is_some_and(|n| Arc::ptr_eq(n, &self.notify)) {
            *slot = None;
        }
    }
}

/// Messages d'erreur lisibles, alignés sur l'ancien front (api.js).
pub(crate) fn http_error(code: u16) -> String {
    match code {
        401 | 403 => format!("Clé refusée (HTTP {code}). Vérifiez la clé fournie par votre DSI."),
        404 => "Endpoint introuvable (404). Vérifiez l'URL de base.".to_string(),
        429 => "Quota atteint (429). Réessayez plus tard.".to_string(),
        c if c >= 500 => format!("Erreur serveur ILaaS (HTTP {c}). Réessayez plus tard."),
        c => format!("Réponse HTTP {c}."),
    }
}

pub(crate) fn normalize_base(base: &str) -> String {
    base.trim().trim_end_matches('/').to_string()
}

pub(crate) fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        // Pas de timeout global : une réponse en streaming peut légitimement durer.
        // Mais on borne l'établissement de connexion et l'inactivité du flux (serveur
        // muet / connexion à demi ouverte) pour éviter une commande bloquée sans fin.
        .connect_timeout(std::time::Duration::from_secs(30))
        .read_timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Client HTTP indisponible : {e}"))
}

/// Message lisible pour une erreur de requête reqwest (timeout vs reste).
pub(crate) fn send_error(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "Délai dépassé : pas de réponse d'ILaaS. Réessayez plus tard.".to_string()
    } else {
        format!("Connexion impossible : {e}")
    }
}

// ───────────────────────────── Modèles ──────────────────────────────

/// GET {base}/models avec la clé fournie → liste d'ids de modèles.
async fn fetch_models(base: &str, key: &str) -> Result<Vec<String>, String> {
    let url = format!("{}/models", normalize_base(base));
    let res = client()?
        .get(&url)
        .bearer_auth(key.trim())
        .send()
        .await
        .map_err(send_error)?;
    let status = res.status();
    if !status.is_success() {
        return Err(http_error(status.as_u16()));
    }
    let data: Value = res
        .json()
        .await
        .map_err(|e| format!("Réponse illisible : {e}"))?;
    let list = parse_models(&data);
    if list.is_empty() {
        return Err("La liste des modèles est vide.".to_string());
    }
    Ok(list)
}

/// Liste les modèles d'inférence (LLM) du profil : URL du profil + clé au trousseau.
#[tauri::command]
pub async fn list_models(
    settings: State<'_, SettingsState>,
    profile_id: String,
) -> Result<Vec<String>, String> {
    let (base, key) = settings::resolve(&settings, &profile_id, "llm")?;
    fetch_models(&base, &key).await
}

/// Extrait les ids de modèles d'une réponse `/models` (`data[].id|name`).
fn parse_models(data: &Value) -> Vec<String> {
    data.get("data")
        .or_else(|| data.get("models"))
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|m| {
                    m.get("id")
                        .or_else(|| m.get("name"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Teste la connexion d'un profil pour une cible ("llm" | "rag") : GET /models.
/// Résout l'URL (métadonnées du profil) + la clé (trousseau) côté Rust.
#[tauri::command]
pub async fn test_connection(
    settings: State<'_, SettingsState>,
    profile_id: String,
    target: String,
) -> Result<Vec<String>, String> {
    let (base, key) = settings::resolve(&settings, &profile_id, &target)?;
    fetch_models(&base, &key).await
}

/// Teste une URL + clé saisies dans l'éditeur SANS rien persister (ni profil, ni
/// trousseau) : permet de valider une clé AVANT de l'enregistrer. Aucune écriture.
#[tauri::command]
pub async fn test_connection_ephemeral(
    base_url: String,
    secret: String,
) -> Result<Vec<String>, String> {
    if secret.trim().is_empty() {
        return Err("Saisissez une clé pour tester.".to_string());
    }
    fetch_models(&base_url, &secret).await
}

// ────────────────────────────── Chat ────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    profile_id: String,
    model: String,
    temperature: f32,
    max_tokens: u32,
    /// Tableau de messages OpenAI ({role, content}) transmis tel quel.
    messages: Value,
    /// Identifiant de l'échange : permet au front d'ignorer les deltas obsolètes.
    request_id: String,
}

#[derive(Serialize)]
pub struct ChatResponse {
    text: String,
    usage: Option<Value>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeltaEvent {
    request_id: String,
    content: String,
}

#[tauri::command]
pub async fn cancel_chat(state: State<'_, ChatState>) -> Result<(), String> {
    if let Some(notify) = state.cancel.lock().unwrap().take() {
        notify.notify_one();
    }
    Ok(())
}

#[tauri::command]
pub async fn chat(
    app: AppHandle,
    state: State<'_, ChatState>,
    settings: State<'_, SettingsState>,
    req: ChatRequest,
) -> Result<ChatResponse, String> {
    // Résout l'URL d'inférence du profil + la clé LLM (trousseau) côté Rust.
    let (base, llm_key) = settings::resolve(&settings, &req.profile_id, "llm")?;
    let url = format!("{}/chat/completions", normalize_base(&base));
    let payload = json!({
        "model": req.model,
        "temperature": req.temperature,
        "max_tokens": req.max_tokens,
        "stream": true,
        // Demande l'objet usage dans le dernier événement du flux (Mistral/ILaaS).
        "stream_options": { "include_usage": true },
        "messages": req.messages,
    });

    // Jeton d'annulation pour CET échange (remplace tout précédent).
    let st: &ChatState = &state;
    let notify = Arc::new(Notify::new());
    *st.cancel.lock().unwrap() = Some(notify.clone());
    // Nettoyage garanti de state.cancel à la sortie, quel que soit le chemin.
    let _guard = CancelGuard { state: st, notify: notify.clone() };

    let res = client()?
        .post(&url)
        .json(&payload)
        .bearer_auth(llm_key.trim())
        .send()
        .await
        .map_err(send_error)?;
    let status = res.status();
    if !status.is_success() {
        // Tente d'extraire un message d'erreur structuré du corps.
        let detail = res.text().await.ok().and_then(|body| {
            serde_json::from_str::<Value>(&body).ok().and_then(|j| {
                j.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .or_else(|| j.get("message").and_then(|m| m.as_str()))
                    .map(|s| s.to_string())
            })
        });
        let mut msg = http_error(status.as_u16());
        if let Some(d) = detail {
            msg.push(' ');
            msg.push_str(&d);
        }
        return Err(msg);
    }

    // Lecture du flux SSE. On bufferise en OCTETS et on ne décode que des LIGNES
    // complètes : un caractère multioctet (accents) ne peut donc pas être coupé
    // entre deux chunks réseau.
    let mut stream = res.bytes_stream();
    let mut buffer: Vec<u8> = Vec::new();
    let mut full = String::new();
    let mut usage: Option<Value> = None;
    let mut done = false;

    'outer: loop {
        tokio::select! {
            // Stop demandé par l'utilisateur.
            _ = notify.notified() => {
                return Err("__ABORT__".to_string());
            }
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        buffer.extend_from_slice(&bytes);
                        while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
                            let line: Vec<u8> = buffer.drain(..=pos).collect();
                            let text = String::from_utf8_lossy(&line);
                            process_sse_line(
                                text.trim_end(), &app, &req.request_id,
                                &mut full, &mut usage, &mut done,
                            );
                            if done { break 'outer; }
                        }
                    }
                    Some(Err(e)) => {
                        if e.is_timeout() {
                            return Err(
                                "Délai dépassé : flux ILaaS interrompu (aucune donnée reçue). Réessayez."
                                    .to_string(),
                            );
                        }
                        return Err(format!("Flux interrompu : {e}"));
                    }
                    None => break 'outer,
                }
            }
        }
    }

    // Dernière ligne résiduelle (flux ne finissant ni par "\n" ni par [DONE]).
    if !buffer.is_empty() {
        let text = String::from_utf8_lossy(&buffer);
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            let before = full.len();
            process_sse_line(
                trimmed, &app, &req.request_id,
                &mut full, &mut usage, &mut done,
            );
            // Résidu qui ressemblait à un event de données mais n'a rien produit ni
            // signalé [DONE] : très probablement un JSON SSE tronqué (serveur fermé
            // brutalement). On évite de renvoyer une réponse silencieusement coupée.
            if !done
                && full.len() == before
                && trimmed.starts_with("data:")
                && trimmed != "data: [DONE]"
            {
                return Err(
                    "Flux interrompu : réponse possiblement tronquée (dernier fragment illisible)."
                        .to_string(),
                );
            }
        }
    }

    Ok(ChatResponse { text: full, usage })
}

/// Traite une ligne SSE ("data: {...}" ou "data: [DONE]").
fn process_sse_line(
    raw: &str,
    app: &AppHandle,
    request_id: &str,
    full: &mut String,
    usage: &mut Option<Value>,
    done: &mut bool,
) {
    let line = raw.trim();
    if line.is_empty() || !line.starts_with("data:") {
        return;
    }
    let data = line[5..].trim();
    if data == "[DONE]" {
        *done = true;
        return;
    }
    let Ok(json) = serde_json::from_str::<Value>(data) else {
        // Fragment JSON incomplet : sans découpage par lignes complètes cela ne
        // devrait pas arriver, on ignore par sécurité.
        return;
    };

    if let Some(content) = json
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("delta"))
        .and_then(|d| d.get("content"))
        .and_then(|c| c.as_str())
    {
        if !content.is_empty() {
            full.push_str(content);
            let _ = app.emit(
                "chat://delta",
                DeltaEvent {
                    request_id: request_id.to_string(),
                    content: content.to_string(),
                },
            );
        }
    }

    if let Some(u) = json.get("usage") {
        if !u.is_null() {
            *usage = Some(u.clone());
        }
    }
}
