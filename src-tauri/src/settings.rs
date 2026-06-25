// Métadonnées NON sensibles des profils (nom, URLs, modèle par défaut, profil
// actif), persistées en JSON dans le dossier de données de l'app. Les secrets
// (clés API) vont au trousseau (voir `keychain.rs`), jamais ici.
//
// Un « profil » porte deux jetons distincts (cf. RAG-V2 §8) : la clé LLM
// (llm.ilaas.fr) et la clé RAG (rag-api.ilaas.fr), stockées séparément au
// trousseau sous les rôles « llm » et « rag ».

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::keychain;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMeta {
    pub id: String,
    pub name: String,
    pub llm_base_url: String,
    pub llm_model: String,
    #[serde(default)]
    pub rag_base_url: Option<String>,
}

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub profiles: Vec<ProfileMeta>,
    #[serde(default)]
    pub active_id: Option<String>,
}

/// État partagé : réglages chargés en mémoire (source de vérité runtime).
#[derive(Default)]
pub struct SettingsState(pub Mutex<AppSettings>);

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Dossier de données indisponible : {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Création du dossier de données : {e}"))?;
    Ok(dir.join("settings.json"))
}

/// Charge les réglages depuis le disque (défaut si absent/illisible).
pub fn load(app: &AppHandle) -> AppSettings {
    match settings_path(app) {
        Ok(p) => std::fs::read_to_string(p)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default(),
        Err(_) => AppSettings::default(),
    }
}

fn persist(app: &AppHandle, s: &AppSettings) -> Result<(), String> {
    let p = settings_path(app)?;
    let json = serde_json::to_string_pretty(s).map_err(|e| format!("Sérialisation : {e}"))?;
    std::fs::write(p, json).map_err(|e| format!("Écriture des réglages : {e}"))
}

/// Vue renvoyée au front : métadonnées + PRÉSENCE des clés (jamais leur valeur).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileView {
    #[serde(flatten)]
    meta: ProfileMeta,
    has_llm_key: bool,
    has_rag_key: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilesPayload {
    profiles: Vec<ProfileView>,
    active_id: Option<String>,
}

fn to_payload(s: &AppSettings) -> ProfilesPayload {
    let profiles = s
        .profiles
        .iter()
        .map(|m| ProfileView {
            has_llm_key: keychain::has_secret(&m.id, "llm"),
            has_rag_key: keychain::has_secret(&m.id, "rag"),
            meta: m.clone(),
        })
        .collect();
    ProfilesPayload {
        profiles,
        active_id: s.active_id.clone(),
    }
}

/// Résout `(base_url, clé)` pour un profil et une cible ("llm" | "rag").
/// Usage INTERNE (chat / list_models / test_connection). Le verrou est relâché
/// avant tout `await` appelant.
pub fn resolve(
    settings: &SettingsState,
    profile_id: &str,
    target: &str,
) -> Result<(String, String), String> {
    let base = {
        let guard = settings.0.lock().unwrap();
        let meta = guard
            .profiles
            .iter()
            .find(|p| p.id == profile_id)
            .ok_or_else(|| "Profil introuvable.".to_string())?;
        match target {
            "llm" => meta.llm_base_url.clone(),
            "rag" => meta
                .rag_base_url
                .clone()
                .ok_or_else(|| "Ce profil n'a pas d'URL RAG configurée.".to_string())?,
            _ => return Err("Cible invalide (attendu : « llm » ou « rag »).".to_string()),
        }
    };
    let key = keychain::get_secret(profile_id, target)?
        .ok_or_else(|| format!("Aucune clé « {target} » pour ce profil."))?;
    Ok((base, key))
}

// ─────────────────────────────── Commandes ───────────────────────────────

#[tauri::command]
pub fn list_profiles(settings: State<'_, SettingsState>) -> ProfilesPayload {
    to_payload(&settings.0.lock().unwrap())
}

#[tauri::command]
pub fn upsert_profile(
    app: AppHandle,
    settings: State<'_, SettingsState>,
    profile: ProfileMeta,
) -> Result<ProfilesPayload, String> {
    let mut g = settings.0.lock().unwrap();
    match g.profiles.iter_mut().find(|p| p.id == profile.id) {
        Some(existing) => *existing = profile.clone(),
        None => g.profiles.push(profile.clone()),
    }
    if g.active_id.is_none() {
        g.active_id = Some(profile.id.clone());
    }
    persist(&app, &g)?;
    Ok(to_payload(&g))
}

#[tauri::command]
pub fn delete_profile(
    app: AppHandle,
    settings: State<'_, SettingsState>,
    profile_id: String,
) -> Result<ProfilesPayload, String> {
    {
        let mut g = settings.0.lock().unwrap();
        g.profiles.retain(|p| p.id != profile_id);
        if g.active_id.as_deref() == Some(profile_id.as_str()) {
            g.active_id = g.profiles.first().map(|p| p.id.clone());
        }
        persist(&app, &g)?;
    }
    keychain::delete_all(&profile_id);
    Ok(to_payload(&settings.0.lock().unwrap()))
}

#[tauri::command]
pub fn set_active_profile(
    app: AppHandle,
    settings: State<'_, SettingsState>,
    profile_id: String,
) -> Result<ProfilesPayload, String> {
    let mut g = settings.0.lock().unwrap();
    if !g.profiles.iter().any(|p| p.id == profile_id) {
        return Err("Profil introuvable.".to_string());
    }
    g.active_id = Some(profile_id);
    persist(&app, &g)?;
    Ok(to_payload(&g))
}
