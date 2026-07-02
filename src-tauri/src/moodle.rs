// Client web services Moodle (REST) — EN LECTURE SEULE.
//
// Liste blanche stricte de fonctions de CONTENU uniquement : aucune donnée
// personnelle (ni notes, ni inscriptions, ni participants). Le jeton est résolu
// au trousseau côté Rust (jamais exposé à la webview). Moodle renvoie souvent ses
// erreurs applicatives en HTTP 200 avec {exception, errorcode, message} : on parse
// TOUJOURS le corps.

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::ilaas::{http_error, normalize_base, send_error};
use crate::settings::{self, SettingsState};

const REST_PATH: &str = "/webservice/rest/server.php";

/// Fonctions de contenu autorisées (liste blanche — pour audit). Zéro donnée perso.
pub(crate) const WHITELIST: &[&str] = &[
    "core_webservice_get_site_info",
    "core_course_get_categories",
    "core_course_get_courses_by_field",
    "core_course_get_contents",
    "mod_page_get_pages_by_courses",
    "mod_label_get_labels_by_courses",
    "mod_resource_get_resources_by_courses",
    "mod_book_get_books_by_courses",
];

fn ws_url(base: &str) -> String {
    format!("{}{}", normalize_base(base), REST_PATH)
}

/// Client dédié Moodle : **redirections DÉSACTIVÉES**. Le jeton voyage dans le CORPS
/// du POST (paramètre `wstoken`) ; suivre une 3xx réémettrait ce corps vers l'hôte
/// cible → un Moodle malveillant/compromis (ou un MITM sur du `http://` LAN) pourrait
/// exfiltrer le jeton. On refuse donc toute redirection (cf. revue sécurité Lot 2).
fn moodle_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(30))
        .read_timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Client HTTP indisponible : {e}"))
}

/// Appel REST bas niveau (POST form-urlencoded). Parse toujours le corps JSON et
/// remonte une erreur applicative Moodle même en HTTP 200.
pub(crate) async fn ws_call(
    base: &str,
    token: &str,
    function: &str,
    params: &[(String, String)],
) -> Result<Value, String> {
    let mut form: Vec<(String, String)> = vec![
        ("wstoken".into(), token.to_string()),
        ("wsfunction".into(), function.to_string()),
        ("moodlewsrestformat".into(), "json".into()),
    ];
    form.extend_from_slice(params);

    let res = moodle_client()?
        .post(ws_url(base))
        .form(&form)
        .send()
        .await
        .map_err(send_error)?;
    let status = res.status();
    // Redirections refusées (jeton dans le corps) : on ne suit jamais, on diagnostique.
    // C'est aussi le symptôme classique d'un `wwwroot`/https mal configuré côté Moodle.
    if status.is_redirection() {
        return Err(format!(
            "Redirection Moodle inattendue (HTTP {}) — vérifie l'URL (wwwroot/https). \
             Le jeton n'a pas été transmis à la cible.",
            status.as_u16()
        ));
    }
    let body = res.text().await.map_err(send_error)?;

    if body.trim().is_empty() {
        // 403 corps vide = web services désactivés côté Moodle (avant même le parsing).
        return Err(if status.as_u16() == 403 {
            "Web services désactivés côté Moodle (ou protocole REST inactif).".to_string()
        } else {
            http_error(status.as_u16())
        });
    }
    let v: Value = serde_json::from_str(&body)
        .map_err(|_| "Réponse Moodle illisible (JSON attendu).".to_string())?;
    if let Some(code) = v.get("errorcode").and_then(|e| e.as_str()) {
        let msg = v.get("message").and_then(|m| m.as_str()).unwrap_or(code);
        return Err(moodle_error(code, msg));
    }
    Ok(v)
}

fn moodle_error(code: &str, msg: &str) -> String {
    match code {
        "invalidtoken" => "Jeton Moodle invalide (introuvable ou révoqué).".to_string(),
        "accessexception" | "webservicerequireslogin" => {
            "Accès refusé : vérifie le service dédié et les fonctions autorisées.".to_string()
        }
        "errorcoursecontextnotvalid" => {
            "Le compte technique n'est pas inscrit à ce cours (contexte invalide).".to_string()
        }
        "servicenotavailable" | "enablewsdescription" => {
            "Web services / protocole REST non activés côté Moodle.".to_string()
        }
        "webservicefilesdownloadingdisabled" => {
            "« Peut télécharger des fichiers » n'est pas coché sur le service Moodle.".to_string()
        }
        _ => format!("Moodle : {msg} ({code})"),
    }
}

/// Diagnostic renvoyé au front (aucune donnée sensible).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteInfo {
    pub sitename: String,
    pub username: String,
    pub release: String,
    pub download_files: bool,
    pub missing_functions: Vec<String>, // fonctions de la whitelist absentes du service
}

fn parse_site_info(v: &Value) -> SiteInfo {
    let functions: Vec<String> = v
        .get("functions")
        .and_then(|f| f.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|f| f.get("name").and_then(|n| n.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let missing_functions = WHITELIST
        .iter()
        .filter(|w| !functions.iter().any(|f| f == **w))
        .map(|s| s.to_string())
        .collect();
    SiteInfo {
        sitename: v.get("sitename").and_then(|s| s.as_str()).unwrap_or("").to_string(),
        username: v.get("username").and_then(|s| s.as_str()).unwrap_or("").to_string(),
        release: v.get("release").and_then(|s| s.as_str()).unwrap_or("").to_string(),
        download_files: v.get("downloadfiles").and_then(|d| d.as_i64()).unwrap_or(0) == 1,
        missing_functions,
    }
}

/// Test d'une connexion Moodle ENREGISTRÉE (jeton résolu au trousseau). `base_url`
/// optionnel : si fourni (URL en cours d'édition à l'écran), il PRIME sur l'URL
/// persistée, pour tester exactement ce que l'utilisateur voit (cf. revue Lot 2).
#[tauri::command]
pub async fn test_moodle_connection(
    settings: State<'_, SettingsState>,
    profile_id: String,
    base_url: Option<String>,
) -> Result<SiteInfo, String> {
    let (persisted, token) = settings::resolve_moodle(&settings, &profile_id)?;
    let base = match base_url {
        Some(u) if !u.trim().is_empty() => {
            let u = u.trim();
            if !u.starts_with("http://") && !u.starts_with("https://") {
                return Err("L'URL Moodle doit commencer par http:// ou https://.".to_string());
            }
            u.to_string()
        }
        _ => persisted,
    };
    let v = ws_call(&base, &token, "core_webservice_get_site_info", &[]).await?;
    Ok(parse_site_info(&v))
}

/// Test d'une URL + jeton SAISIS (avant enregistrement) — rien n'est persisté.
#[tauri::command]
pub async fn test_moodle_connection_ephemeral(
    base_url: String,
    token: String,
) -> Result<SiteInfo, String> {
    let base = base_url.trim();
    if !base.starts_with("http://") && !base.starts_with("https://") {
        return Err("L'URL Moodle doit commencer par http:// ou https://.".to_string());
    }
    let v = ws_call(base, token.trim(), "core_webservice_get_site_info", &[]).await?;
    Ok(parse_site_info(&v))
}

/// Cours accessible à la connexion (métadonnées d'affichage — pas de contenu).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseBrief {
    pub id: i64,
    pub shortname: String,
    pub fullname: String,
    pub category: String,
    pub visible: bool,
}

fn parse_courses(v: &Value) -> Vec<CourseBrief> {
    v.get("courses")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|c| {
                    let id = c.get("id").and_then(|x| x.as_i64())?;
                    // id=1 = cours « site » (page d'accueil Moodle) : jamais indexé.
                    if id == 1 {
                        return None;
                    }
                    Some(CourseBrief {
                        id,
                        shortname: c.get("shortname").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                        fullname: c.get("fullname").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                        category: c.get("categoryname").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                        visible: c.get("visible").and_then(|x| x.as_i64()).unwrap_or(1) == 1,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Liste les cours accessibles à la connexion (hors cours « site »). Lecture seule.
#[tauri::command]
pub async fn list_moodle_courses(
    settings: State<'_, SettingsState>,
    profile_id: String,
) -> Result<Vec<CourseBrief>, String> {
    let (base, token) = settings::resolve_moodle(&settings, &profile_id)?;
    let v = ws_call(&base, &token, "core_course_get_courses_by_field", &[]).await?;
    Ok(parse_courses(&v))
}
