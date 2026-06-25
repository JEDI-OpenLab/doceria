// Vérification de mise à jour via l'API GitHub Releases.
// Le réseau se fait en Rust (comme le reste de l'app) → hors webview, pas de CSP, pas de CORS.
// Cette version NE télécharge/installe PAS automatiquement (ce qui exigerait des artefacts
// signés avec la clé updater de Tauri) : elle informe et ouvre le .dmg de la release.

use serde_json::{json, Value};
use std::time::Duration;
use tauri::AppHandle;

const RELEASES_API: &str = "https://api.github.com/repos/JEDI-OpenLab/doceria/releases/latest";

/// Interroge la dernière release GitHub et renvoie { current, latest, htmlUrl, dmgUrl }.
/// Erreur silencieuse côté appelant si hors-ligne / pas de release / quota atteint.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Value, String> {
    let current = app.package_info().version.to_string();
    let client = reqwest::Client::builder()
        .user_agent("Doceria")
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get(RELEASES_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("GitHub HTTP {}", res.status().as_u16()));
    }
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    let tag = body.get("tag_name").and_then(|v| v.as_str()).unwrap_or("");
    let latest = tag.trim_start_matches('v').trim().to_string();
    let html_url = body
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    // Lien direct vers le .dmg s'il est attaché à la release.
    let dmg_url = body
        .get("assets")
        .and_then(|a| a.as_array())
        .and_then(|arr| {
            arr.iter().find_map(|asset| {
                let name = asset.get("name").and_then(|v| v.as_str()).unwrap_or("");
                if name.to_lowercase().ends_with(".dmg") {
                    asset
                        .get("browser_download_url")
                        .and_then(|v| v.as_str())
                        .map(str::to_string)
                } else {
                    None
                }
            })
        })
        .unwrap_or_default();
    Ok(json!({ "current": current, "latest": latest, "htmlUrl": html_url, "dmgUrl": dmg_url }))
}

/// Ouvre une URL **https** dans le navigateur par défaut (page/.dmg de la release).
/// On refuse tout ce qui n'est pas https pour ne jamais ouvrir n'importe quoi.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("URL non autorisée.".into());
    }
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(target_os = "linux")]
    let mut cmd = std::process::Command::new("xdg-open");
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", "start", ""]);
        c
    };
    cmd.arg(&url);
    cmd.spawn().map_err(|e| e.to_string())?;
    Ok(())
}
