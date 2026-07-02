// Stockage des secrets (clés API) au trousseau OS via la crate `keyring`.
//
// Le webview ne voit JAMAIS la valeur d'une clé : il ne manipule que des
// identifiants de profil et un rôle ("llm" | "rag"). Une entrée trousseau par
// couple (profil, rôle). Aucune commande ne renvoie la valeur d'une clé au front
// (set est write-only ; la lecture est strictement interne au Rust).

const SERVICE: &str = "fr.jedi-openlab.doceria";

fn account(profile_id: &str, role: &str) -> String {
    format!("{profile_id}:{role}")
}

fn entry(profile_id: &str, role: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, &account(profile_id, role))
        .map_err(|e| format!("Trousseau indisponible : {e}"))
}

/// Lit un secret. Usage INTERNE au Rust uniquement — jamais exposé au front.
pub fn get_secret(profile_id: &str, role: &str) -> Result<Option<String>, String> {
    match entry(profile_id, role)?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Lecture du trousseau : {e}")),
    }
}

/// Présence d'un secret (pour informer l'UI sans dévoiler la valeur).
pub fn has_secret(profile_id: &str, role: &str) -> bool {
    matches!(get_secret(profile_id, role), Ok(Some(_)))
}

fn set_secret(profile_id: &str, role: &str, secret: &str) -> Result<(), String> {
    entry(profile_id, role)?
        .set_password(secret)
        .map_err(|e| format!("Écriture au trousseau : {e}"))
}

fn delete_secret(profile_id: &str, role: &str) -> Result<(), String> {
    match entry(profile_id, role)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Suppression au trousseau : {e}")),
    }
}

/// Retire les deux clés (llm + rag) d'un profil supprimé. Best-effort.
pub fn delete_all(profile_id: &str) {
    let _ = delete_secret(profile_id, "llm");
    let _ = delete_secret(profile_id, "rag");
}

/// Retire le jeton Moodle d'un profil Moodle supprimé. Best-effort.
pub fn delete_moodle(profile_id: &str) {
    let _ = delete_secret(profile_id, "moodle");
}

/// Commande : définit (ou efface si `secret` vide) la clé d'un profil/rôle.
/// Write-only : aucune valeur de clé n'est jamais renvoyée au front.
#[tauri::command]
pub fn set_profile_key(profile_id: String, role: String, secret: String) -> Result<(), String> {
    if role != "llm" && role != "rag" && role != "moodle" {
        return Err("Rôle de clé invalide (attendu : « llm », « rag » ou « moodle »).".to_string());
    }
    let s = secret.trim();
    if s.is_empty() {
        delete_secret(&profile_id, &role)
    } else {
        set_secret(&profile_id, &role, s)
    }
}
