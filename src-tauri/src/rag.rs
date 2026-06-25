// Client du RAG géré ILaaS (passerelle OpenGateLLM, rag-api.ilaas.fr).
//
// L'URL RAG et la clé RAG sont résolues depuis le profil actif (rôle « rag ») via
// settings::resolve — la clé reste au trousseau, jamais côté webview. Contrat d'API
// vérifié : docs/RAG-V2-ilaas.md. Les réponses sont renvoyées en JSON brut (Value)
// pour rester tolérant aux évolutions de la bêta OpenGateLLM ; le front extrait ce
// dont il a besoin.
//
// Souveraineté : en V2 (RAG géré), les documents quittent la machine vers l'infra
// ESR souveraine, en collections « private ». L'abstraction RAG local ⇄ géré
// permettra de garder un dossier en local si besoin (non implémenté ici).

use serde_json::{json, Value};
use tauri::State;

use crate::ilaas::{client, http_error, normalize_base, send_error};
use crate::settings::{self, SettingsState};

/// Message d'erreur lisible à partir du code HTTP + corps ({detail} ou {message}).
fn rag_error(code: u16, body: &str) -> String {
    let detail = serde_json::from_str::<Value>(body).ok().and_then(|j| {
        j.get("detail").or_else(|| j.get("message")).map(|d| match d {
            // 403/404… : detail est une chaîne → message direct.
            Value::String(s) => s.clone(),
            // 422 FastAPI/OpenGateLLM : detail = [{loc, msg, type}, …] → on extrait les msg.
            Value::Array(arr) => {
                let msgs: Vec<&str> = arr
                    .iter()
                    .filter_map(|e| e.get("msg").and_then(Value::as_str))
                    .collect();
                if msgs.is_empty() {
                    d.to_string()
                } else {
                    msgs.join(" ; ")
                }
            }
            _ => d.to_string(),
        })
    });
    match detail {
        // On met en avant le message du serveur (ex. « Collection not found »),
        // sans le préfixe générique « Vérifiez l'URL de base » qui induit en erreur.
        Some(d) if !d.trim().is_empty() => format!("Erreur RAG (HTTP {code}) : {d}"),
        _ => http_error(code),
    }
}

/// Lit le corps en texte puis le parse en JSON, en mappant un statut non-2xx en erreur.
async fn json_or_error(res: reqwest::Response) -> Result<Value, String> {
    let status = res.status();
    let body = res
        .text()
        .await
        .map_err(|e| format!("Réponse illisible : {e}"))?;
    if !status.is_success() {
        return Err(rag_error(status.as_u16(), &body));
    }
    if body.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&body).map_err(|e| format!("JSON illisible : {e}"))
}

// ───────────────────────────── Collections ─────────────────────────────

#[tauri::command]
pub async fn rag_list_collections(
    settings: State<'_, SettingsState>,
    profile_id: String,
) -> Result<Value, String> {
    let (base, key) = settings::resolve(&settings, &profile_id, "rag")?;
    let url = format!("{}/collections", normalize_base(&base));
    let res = client()?
        .get(&url)
        .bearer_auth(key.trim())
        .send()
        .await
        .map_err(send_error)?;
    json_or_error(res).await
}

#[tauri::command]
pub async fn rag_create_collection(
    settings: State<'_, SettingsState>,
    profile_id: String,
    name: String,
    description: Option<String>,
) -> Result<Value, String> {
    let (base, key) = settings::resolve(&settings, &profile_id, "rag")?;
    let url = format!("{}/collections", normalize_base(&base));
    // visibility « private » : collection visible/recherchable par le seul propriétaire.
    let payload = json!({ "name": name, "description": description, "visibility": "private" });
    let res = client()?
        .post(&url)
        .bearer_auth(key.trim())
        .json(&payload)
        .send()
        .await
        .map_err(send_error)?;
    json_or_error(res).await
}

#[tauri::command]
pub async fn rag_delete_collection(
    settings: State<'_, SettingsState>,
    profile_id: String,
    collection_id: i64,
) -> Result<(), String> {
    let (base, key) = settings::resolve(&settings, &profile_id, "rag")?;
    let url = format!("{}/collections/{}", normalize_base(&base), collection_id);
    let res = client()?
        .delete(&url)
        .bearer_auth(key.trim())
        .send()
        .await
        .map_err(send_error)?;
    let status = res.status();
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(rag_error(status.as_u16(), &body));
    }
    Ok(())
}

/// Identité RAG du profil (GET /me/info) — utilisée pour ne lister que les
/// collections dont l'utilisateur est propriétaire.
#[tauri::command]
pub async fn rag_me(
    settings: State<'_, SettingsState>,
    profile_id: String,
) -> Result<Value, String> {
    let (base, key) = settings::resolve(&settings, &profile_id, "rag")?;
    let url = format!("{}/me/info", normalize_base(&base));
    let res = client()?
        .get(&url)
        .bearer_auth(key.trim())
        .send()
        .await
        .map_err(send_error)?;
    json_or_error(res).await
}

// ────────────────────────────── Documents ──────────────────────────────

/// Téléverse un fichier local dans une collection (multipart). Le serveur découpe
/// et vectorise (bge-m3). Renvoie au moins `{ id }`.
#[tauri::command]
pub async fn rag_upload_document(
    settings: State<'_, SettingsState>,
    profile_id: String,
    collection_id: i64,
    file_path: String,
    name: Option<String>,
) -> Result<Value, String> {
    let (base, key) = settings::resolve(&settings, &profile_id, "rag")?;
    let url = format!("{}/documents", normalize_base(&base));

    let bytes = std::fs::read(&file_path).map_err(|e| format!("Lecture du fichier : {e}"))?;
    let fname = name.unwrap_or_else(|| {
        std::path::Path::new(&file_path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("document")
            .to_string()
    });

    // Type MIME explicite : certains parseurs (OpenGateLLM) rejettent un part sans
    // Content-Type ou en application/octet-stream non reconnu.
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(fname.clone())
        .mime_str(guess_mime(&file_path))
        .map_err(|e| format!("Type MIME invalide : {e}"))?;
    // Champs texte AVANT le fichier ; on envoie collection_id ET l'alias collection
    // (tolérance aux variations de millésime OpenGateLLM).
    let form = reqwest::multipart::Form::new()
        .text("collection_id", collection_id.to_string())
        .text("collection", collection_id.to_string())
        .text("name", fname)
        .part("file", part);

    let res = client()?
        .post(&url)
        .bearer_auth(key.trim())
        .multipart(form)
        .send()
        .await
        .map_err(send_error)?;
    json_or_error(res).await
}

/// Récupère un document (GET /documents/{id}) — pour résoudre son nom dans les citations.
#[tauri::command]
pub async fn rag_get_document(
    settings: State<'_, SettingsState>,
    profile_id: String,
    document_id: i64,
) -> Result<Value, String> {
    let (base, key) = settings::resolve(&settings, &profile_id, "rag")?;
    let url = format!("{}/documents/{}", normalize_base(&base), document_id);
    let res = client()?
        .get(&url)
        .bearer_auth(key.trim())
        .send()
        .await
        .map_err(send_error)?;
    json_or_error(res).await
}

#[tauri::command]
pub async fn rag_delete_document(
    settings: State<'_, SettingsState>,
    profile_id: String,
    document_id: i64,
) -> Result<(), String> {
    let (base, key) = settings::resolve(&settings, &profile_id, "rag")?;
    let url = format!("{}/documents/{}", normalize_base(&base), document_id);
    let res = client()?
        .delete(&url)
        .bearer_auth(key.trim())
        .send()
        .await
        .map_err(send_error)?;
    let status = res.status();
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(rag_error(status.as_u16(), &body));
    }
    Ok(())
}

/// Devine le type MIME d'un fichier d'après son extension (pour l'upload multipart).
fn guess_mime(path: &str) -> &'static str {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "pdf" => "application/pdf",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "json" => "application/json",
        "csv" => "text/csv",
        "md" | "markdown" => "text/markdown",
        "txt" | "log" | "tsv" => "text/plain",
        _ => "application/octet-stream",
    }
}

/// Métadonnées d'un fichier supporté (pour la synchronisation dossier ↔ collection).
#[derive(serde::Serialize)]
pub struct DirEntry {
    pub path: String,
    pub size: u64,
    pub mtime: u64, // date de modification, epoch millisecondes
}

/// Parcourt récursivement un dossier et renvoie les fichiers supportés avec leur taille
/// et leur date de modification. Ne lit pas le contenu. Ignore les fichiers cachés et NE
/// SUIT PAS les liens symboliques (pour ne jamais sortir du dossier réellement choisi).
fn walk_supported(dir_path: &str) -> Vec<DirEntry> {
    const EXTS: &[&str] = &[
        "txt", "md", "markdown", "csv", "tsv", "json", "log", "pdf", "docx",
    ];
    let mut out = Vec::new();
    let mut stack = vec![std::path::PathBuf::from(dir_path)];
    let mut dirs_seen = 0usize;
    while let Some(dir) = stack.pop() {
        dirs_seen += 1;
        if dirs_seen > 5000 {
            break; // garde-fou anti-arborescence pathologique
        }
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let hidden = path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with('.'))
                .unwrap_or(false);
            if hidden {
                continue;
            }
            let ft = match entry.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                stack.push(path);
                continue;
            }
            if ft.is_file() {
                let ext_ok = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| EXTS.contains(&e.to_lowercase().as_str()))
                    .unwrap_or(false);
                if !ext_ok {
                    continue;
                }
                let meta = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                let mtime = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                if let Some(s) = path.to_str() {
                    out.push(DirEntry {
                        path: s.to_string(),
                        size: meta.len(),
                        mtime,
                    });
                }
            }
        }
    }
    out
}

/// Énumère récursivement les fichiers supportés d'un dossier (chemins seuls).
#[tauri::command]
pub fn list_dir_files(dir_path: String) -> Result<Vec<String>, String> {
    Ok(walk_supported(&dir_path).into_iter().map(|e| e.path).collect())
}

/// Comme `list_dir_files`, mais renvoie taille + date de modif par fichier (pour détecter
/// ajouts / modifications / suppressions lors d'une synchronisation dossier ↔ collection).
#[tauri::command]
pub fn list_dir_entries(dir_path: String) -> Result<Vec<DirEntry>, String> {
    Ok(walk_supported(&dir_path))
}

// ─────────────────────────── Recherche / rerank ───────────────────────────

/// Recherche dans une ou plusieurs collections. `method` : semantic | lexical | hybrid.
/// Renvoie `Searches { object, data:[{ method, score, chunk }], usage }`.
#[tauri::command]
pub async fn rag_search(
    settings: State<'_, SettingsState>,
    profile_id: String,
    collection_ids: Vec<i64>,
    query: String,
    limit: Option<u32>,
    method: Option<String>,
    score_threshold: Option<f32>,
) -> Result<Value, String> {
    let (base, key) = settings::resolve(&settings, &profile_id, "rag")?;
    let url = format!("{}/search", normalize_base(&base));
    let mut payload = json!({
        "collection_ids": collection_ids,
        "query": query,
        "method": method.unwrap_or_else(|| "hybrid".to_string()),
        "limit": limit.unwrap_or(5),
    });
    // Seuil de similarité : on ne l'envoie que s'il est demandé (sinon défaut serveur).
    if let Some(t) = score_threshold {
        payload["score_threshold"] = json!(t);
    }
    let res = client()?
        .post(&url)
        .bearer_auth(key.trim())
        .json(&payload)
        .send()
        .await
        .map_err(send_error)?;
    json_or_error(res).await
}

/// Réordonne des passages par pertinence (bge-reranker-v2-m3).
/// Renvoie `Reranks { results:[{ relevance_score, index }], ... }`.
#[tauri::command]
pub async fn rag_rerank(
    settings: State<'_, SettingsState>,
    profile_id: String,
    query: String,
    documents: Vec<String>,
    top_n: Option<u32>,
) -> Result<Value, String> {
    let (base, key) = settings::resolve(&settings, &profile_id, "rag")?;
    let url = format!("{}/rerank", normalize_base(&base));
    let mut payload = json!({
        "model": "bge-reranker-v2-m3",
        "query": query,
        "documents": documents,
    });
    // On n'envoie `top_n` que s'il est demandé (le tri/écrêtage final se fait aussi côté client).
    if let Some(n) = top_n {
        payload["top_n"] = json!(n);
    }
    let res = client()?
        .post(&url)
        .bearer_auth(key.trim())
        .json(&payload)
        .send()
        .await
        .map_err(send_error)?;
    json_or_error(res).await
}
