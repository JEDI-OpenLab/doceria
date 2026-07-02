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

/* ───────────── Conversion HTML → Markdown (maison, sans dépendance) ─────────────
 * Couvre l'essentiel des résumés Moodle : titres, paragraphes, listes, gras/italique,
 * liens, sauts de ligne ; strip du reste (div/span/attributs) ; décodage des entités.
 * Best-effort assumé (cf. décision Lot 0 : garder l'app légère ~15 Mo, pas de crate
 * html2md). Les cas exotiques (tableaux imbriqués) dégradent proprement en texte.
 */

enum Node {
    Text(String),
    Open(String, Option<String>), // (balise, href pour <a>)
    Close(String),
}

pub(crate) fn html_to_markdown(html: &str) -> String {
    if html.trim().is_empty() {
        return String::new();
    }
    let toks = tokenize_html(html);
    normalize_md(&serialize_md(&toks))
}

fn tokenize_html(html: &str) -> Vec<Node> {
    let mut out = Vec::new();
    let mut text = String::new(); // accumulateur de texte (traverse les « < » littéraux)
    let mut rest = html;
    while !rest.is_empty() {
        let lt = match rest.find('<') {
            Some(i) => i,
            None => {
                text.push_str(rest);
                break;
            }
        };
        text.push_str(&rest[..lt]);
        let after = &rest[lt..]; // commence par '<'
        // '<' n'est une balise que s'il est suivi d'une lettre, '/', '!' ou '?'.
        // Sinon c'est un « < » littéral de prose (ex. « 3 < 5 ») → on le garde.
        let is_tag = after[1..]
            .chars()
            .next()
            .map(|c| c.is_ascii_alphabetic() || c == '/' || c == '!' || c == '?')
            .unwrap_or(false);
        if !is_tag {
            text.push('<');
            rest = &after[1..];
            continue;
        }
        // Cherche le '>' de fin en respectant les guillemets d'attribut (un '>' entre
        // quotes, ex. data-x="a>b", ne termine pas la balise).
        let body = &after[1..];
        let mut quote: Option<char> = None;
        let mut end = None;
        for (j, ch) in body.char_indices() {
            match quote {
                Some(q) => {
                    if ch == q {
                        quote = None;
                    }
                }
                None => {
                    if ch == '"' || ch == '\'' {
                        quote = Some(ch);
                    } else if ch == '>' {
                        end = Some(j);
                        break;
                    }
                }
            }
        }
        match end {
            None => {
                // Balise jamais fermée : on garde '<' en littéral et on reprend après.
                text.push('<');
                rest = &after[1..];
            }
            Some(gt) => {
                if !text.is_empty() {
                    out.push(Node::Text(collapse_ws(&decode_entities(&text))));
                    text.clear();
                }
                parse_tag(&body[..gt], &mut out);
                rest = &body[gt + 1..];
            }
        }
    }
    if !text.is_empty() {
        out.push(Node::Text(collapse_ws(&decode_entities(&text))));
    }
    out
}

fn parse_tag(raw: &str, out: &mut Vec<Node>) {
    let raw = raw.trim();
    if raw.is_empty() || raw.starts_with('!') || raw.starts_with('?') {
        return; // commentaire, doctype, PI → ignoré
    }
    if let Some(name) = raw.strip_prefix('/') {
        let tag = name.trim().split_whitespace().next().unwrap_or("").to_ascii_lowercase();
        if !tag.is_empty() {
            out.push(Node::Close(tag));
        }
        return;
    }
    let tag = raw
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim_end_matches('/')
        .to_ascii_lowercase();
    if tag.is_empty() {
        return;
    }
    let href = if tag == "a" { extract_attr(raw, "href") } else { None };
    out.push(Node::Open(tag, href));
}

fn extract_attr(raw: &str, attr: &str) -> Option<String> {
    let lower = raw.to_ascii_lowercase();
    let key = format!("{attr}=");
    let pos = lower.find(&key)? + key.len();
    let bytes = raw.as_bytes();
    if pos >= raw.len() {
        return None;
    }
    let q = bytes[pos];
    if q == b'"' || q == b'\'' {
        let start = pos + 1;
        let end = raw[start..].find(q as char)? + start;
        Some(decode_entities(&raw[start..end]))
    } else {
        let end = raw[pos..].find(char::is_whitespace).map(|i| i + pos).unwrap_or(raw.len());
        Some(decode_entities(raw[pos..end].trim()))
    }
}

fn serialize_md(toks: &[Node]) -> String {
    let mut s = String::new();
    // Pile inline : (position avant l'ouvreur, longueur de l'ouvreur, fermeture à émettre).
    // Permet de supprimer un élément vide à la fermeture (pas de « **** », « `` », « [](url) »).
    let mut inline_stack: Vec<(usize, usize, String)> = Vec::new();
    let mut list_stack: Vec<Option<u32>> = Vec::new(); // Some(n) = liste ordonnée, None = à puces
    for t in toks {
        match t {
            Node::Text(txt) => s.push_str(txt),
            Node::Open(tag, href) => match tag.as_str() {
                "br" => s.push('\n'),
                "hr" => s.push_str("\n\n---\n\n"),
                "p" | "div" | "section" | "article" | "header" | "footer" | "table" | "tr" => {
                    s.push_str("\n\n")
                }
                "h1" => s.push_str("\n\n# "),
                "h2" => s.push_str("\n\n## "),
                "h3" => s.push_str("\n\n### "),
                "h4" => s.push_str("\n\n#### "),
                "h5" => s.push_str("\n\n##### "),
                "h6" => s.push_str("\n\n###### "),
                "ul" => {
                    s.push('\n');
                    list_stack.push(None);
                }
                "ol" => {
                    s.push('\n');
                    list_stack.push(Some(1));
                }
                "li" => {
                    s.push('\n');
                    for _ in 0..list_stack.len().saturating_sub(1) {
                        s.push_str("  ");
                    }
                    match list_stack.last_mut() {
                        Some(Some(n)) => {
                            s.push_str(&format!("{n}. "));
                            *n += 1;
                        }
                        _ => s.push_str("- "),
                    }
                }
                "strong" | "b" => {
                    inline_stack.push((s.len(), 2, "**".into()));
                    s.push_str("**");
                }
                "em" | "i" => {
                    inline_stack.push((s.len(), 1, "*".into()));
                    s.push('*');
                }
                "code" => {
                    inline_stack.push((s.len(), 1, "`".into()));
                    s.push('`');
                }
                "blockquote" => s.push_str("\n\n> "),
                "td" | "th" => s.push(' '),
                "a" => match href {
                    Some(u) if !u.trim().is_empty() => {
                        inline_stack.push((s.len(), 1, format!("]({})", u.trim())));
                        s.push('[');
                    }
                    _ => inline_stack.push((s.len(), 0, String::new())),
                },
                _ => {}
            },
            Node::Close(tag) => match tag.as_str() {
                "p" | "div" | "section" | "article" | "header" | "footer" | "table" | "tr"
                | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => s.push_str("\n\n"),
                "ul" | "ol" => {
                    list_stack.pop();
                    s.push('\n');
                }
                "blockquote" => s.push_str("\n\n"),
                // Inline : supprime l'ouvreur si le contenu est vide (pas de marqueur orphelin).
                "strong" | "b" | "em" | "i" | "code" | "a" => {
                    if let Some((start, opener_len, closer)) = inline_stack.pop() {
                        if s[start + opener_len..].trim().is_empty() {
                            s.truncate(start);
                        } else {
                            s.push_str(&closer);
                        }
                    }
                }
                _ => {}
            },
        }
    }
    s
}

/// Réduit toute suite d'espaces/tabs/sauts de ligne à une seule espace (comme le fait
/// le rendu HTML). Les sauts de ligne « structurels » proviennent des balises, pas du texte.
fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_space = false;
    for ch in s.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
        } else {
            out.push(ch);
            prev_space = false;
        }
    }
    out
}

/// Trim de fin de ligne + réduction de 3+ sauts de ligne à 2 + trim global.
fn normalize_md(s: &str) -> String {
    let joined = s
        .lines()
        .map(|l| l.trim_end())
        .collect::<Vec<_>>()
        .join("\n");
    let mut result = String::with_capacity(joined.len());
    let mut nl = 0;
    for ch in joined.chars() {
        if ch == '\n' {
            nl += 1;
            if nl <= 2 {
                result.push('\n');
            }
        } else {
            nl = 0;
            result.push(ch);
        }
    }
    result.trim().to_string()
}

fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let after = &rest[amp..];
        // Cherche « ; » dans les 12 premiers caractères (borne char-safe : pas de découpe
        // d'octets au milieu d'un caractère UTF-8 accentué).
        let semi = after.char_indices().take(12).find(|(_, c)| *c == ';').map(|(i, _)| i);
        if let Some(semi) = semi {
            if let Some(ch) = decode_one(&after[1..semi]) {
                out.push_str(&ch);
                rest = &after[semi + 1..];
                continue;
            }
        }
        out.push('&');
        rest = &after[1..];
    }
    out.push_str(rest);
    out
}

fn decode_one(ent: &str) -> Option<String> {
    let mapped = match ent {
        "amp" => "&",
        "lt" => "<",
        "gt" => ">",
        "quot" => "\"",
        "apos" => "'",
        "nbsp" => " ",
        "hellip" => "…",
        "mdash" => "—",
        "ndash" => "–",
        "laquo" => "«",
        "raquo" => "»",
        "rsquo" => "’",
        "lsquo" => "‘",
        "ldquo" => "“",
        "rdquo" => "”",
        "eacute" => "é",
        "egrave" => "è",
        "ecirc" => "ê",
        "euml" => "ë",
        "agrave" => "à",
        "acirc" => "â",
        "auml" => "ä",
        "ccedil" => "ç",
        "icirc" => "î",
        "iuml" => "ï",
        "ocirc" => "ô",
        "ouml" => "ö",
        "ugrave" => "ù",
        "ucirc" => "û",
        "uuml" => "ü",
        "ntilde" => "ñ",
        "deg" => "°",
        "euro" => "€",
        "copy" => "©",
        "reg" => "®",
        "trade" => "™",
        _ => {
            let code = ent.strip_prefix('#').and_then(|rest| {
                rest.strip_prefix(['x', 'X'])
                    .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                    .or_else(|| rest.parse::<u32>().ok())
            })?;
            return char::from_u32(code).map(|c| c.to_string());
        }
    };
    Some(mapped.to_string())
}

/// Fichier joint à un cours (métadonnées ; le contenu se télécharge via `moodle_download_file`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseFile {
    pub filename: String,
    pub fileurl: String,
    pub mimetype: String,
    pub filesize: i64,
}

/// Markdown assemblé pour un cours + la liste de ses fichiers joints (Lot 4).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseMarkdown {
    pub course_id: i64,
    pub fullname: String,
    pub markdown: String,
    pub sections: usize, // nombre de sections retenues (avec du texte)
    pub chars: usize,
    pub files: Vec<CourseFile>, // fichiers joints (PDF…) — ingérés au Lot 4
}

/// Récupère le texte d'un cours (résumé du cours + titre/résumé de chaque section +
/// descriptions de modules) et l'assemble en un Markdown hiérarchisé. LECTURE SEULE.
#[tauri::command]
pub async fn moodle_course_markdown(
    settings: State<'_, SettingsState>,
    profile_id: String,
    course_id: i64,
) -> Result<CourseMarkdown, String> {
    let (base, token) = settings::resolve_moodle(&settings, &profile_id)?;

    // 1) Méta du cours : nom + résumé d'introduction.
    let meta = ws_call(
        &base,
        &token,
        "core_course_get_courses_by_field",
        &[("field".into(), "id".into()), ("value".into(), course_id.to_string())],
    )
    .await?;
    let course = meta.get("courses").and_then(|c| c.as_array()).and_then(|a| a.first());
    let fullname = course
        .and_then(|c| c.get("fullname"))
        .and_then(|s| s.as_str())
        .unwrap_or("Cours")
        .trim()
        .to_string();
    let course_summary = course
        .and_then(|c| c.get("summary"))
        .and_then(|s| s.as_str())
        .unwrap_or("");

    // 2) Contenu : sections + modules.
    let contents = ws_call(
        &base,
        &token,
        "core_course_get_contents",
        &[("courseid".into(), course_id.to_string())],
    )
    .await?;

    // 3) Assemblage Markdown (H1 cours · H2 section · H3 module).
    let mut md = format!("# {fullname}\n\n");
    let intro = html_to_markdown(course_summary);
    if !intro.is_empty() {
        md.push_str(&intro);
        md.push_str("\n\n");
    }
    let mut sections = 0usize;
    let mut files: Vec<CourseFile> = Vec::new();
    if let Some(list) = contents.as_array() {
        for s in list {
            let name = s.get("name").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
            let summary_md =
                html_to_markdown(s.get("summary").and_then(|x| x.as_str()).unwrap_or(""));
            let mut mods_md = String::new();
            if let Some(mods) = s.get("modules").and_then(|m| m.as_array()) {
                for m in mods {
                    // Fichiers joints : collectés pour TOUTES les sections, même sans texte
                    // (ex. une section « Généralités » qui ne contient qu'un PDF).
                    if let Some(conts) = m.get("contents").and_then(|c| c.as_array()) {
                        for c in conts {
                            if c.get("type").and_then(|t| t.as_str()) != Some("file") {
                                continue;
                            }
                            if let Some(url) = c.get("fileurl").and_then(|u| u.as_str()) {
                                files.push(CourseFile {
                                    filename: c.get("filename").and_then(|x| x.as_str()).unwrap_or("fichier").to_string(),
                                    fileurl: url.to_string(),
                                    mimetype: c.get("mimetype").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                                    filesize: c.get("filesize").and_then(|x| x.as_i64()).unwrap_or(0),
                                });
                            }
                        }
                    }
                    let desc =
                        html_to_markdown(m.get("description").and_then(|x| x.as_str()).unwrap_or(""));
                    if desc.is_empty() {
                        continue;
                    }
                    let mname = m.get("name").and_then(|x| x.as_str()).unwrap_or("").trim();
                    if !mname.is_empty() {
                        mods_md.push_str(&format!("### {mname}\n\n"));
                    }
                    mods_md.push_str(&desc);
                    mods_md.push_str("\n\n");
                }
            }
            if summary_md.is_empty() && mods_md.is_empty() {
                continue; // section sans texte (ex. seulement des PDF) → Lot 4
            }
            sections += 1;
            let heading = if name.is_empty() { format!("Section {sections}") } else { name };
            md.push_str(&format!("## {heading}\n\n"));
            if !summary_md.is_empty() {
                md.push_str(&summary_md);
                md.push_str("\n\n");
            }
            md.push_str(&mods_md);
        }
    }

    let markdown = md.trim().to_string();
    let chars = markdown.chars().count();
    Ok(CourseMarkdown { course_id, fullname, markdown, sections, chars, files })
}

/// Origine (scheme://authority) d'une URL — pour comparer deux URLs sans dépendance.
fn origin_of(url: &str) -> Option<String> {
    let scheme_end = url.find("://")?;
    let after = &url[scheme_end + 3..];
    let auth_len = after.find('/').unwrap_or(after.len());
    Some(url[..scheme_end + 3 + auth_len].to_string())
}

/// Télécharge un fichier d'un cours (pluginfile) et renvoie ses OCTETS au front (extraction
/// locale ensuite, cf. rag_upload_text). LECTURE SEULE. Le jeton (résolu au trousseau) est
/// ajouté en query — donc on VÉRIFIE d'abord que l'URL est bien sur l'hôte Moodle configuré
/// (anti-exfiltration), et on refuse toute redirection (cf. revue sécurité).
#[tauri::command]
pub async fn moodle_download_file(
    settings: State<'_, SettingsState>,
    profile_id: String,
    file_url: String,
) -> Result<tauri::ipc::Response, String> {
    let (base, token) = settings::resolve_moodle(&settings, &profile_id)?;
    let base_origin = origin_of(&base).ok_or_else(|| "URL Moodle invalide.".to_string())?;
    let file_origin =
        origin_of(&file_url).ok_or_else(|| "URL de fichier invalide.".to_string())?;
    if base_origin != file_origin {
        return Err("Fichier hors du domaine Moodle configuré — téléchargement refusé.".to_string());
    }
    let sep = if file_url.contains('?') { '&' } else { '?' };
    let url = format!("{file_url}{sep}token={token}");

    let res = moodle_client()?.get(url).send().await.map_err(send_error)?;
    let status = res.status();
    if status.is_redirection() {
        return Err(format!(
            "Redirection inattendue (HTTP {}) au téléchargement — vérifie l'URL/le jeton.",
            status.as_u16()
        ));
    }
    if !status.is_success() {
        return Err(http_error(status.as_u16()));
    }
    let bytes = res.bytes().await.map_err(send_error)?;
    const MAX: usize = 40 * 1024 * 1024; // garde-fou dur (40 Mo)
    if bytes.len() > MAX {
        return Err("Fichier trop volumineux (> 40 Mo).".to_string());
    }
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn md_basics() {
        let html = "<div class=\"c\"><p>Bonjour <strong>le</strong> <em>monde</em> &amp; l&#39;IA.</p>\
            <ul><li>un</li><li>deux</li></ul>\
            <p>Voir <a href=\"https://ex.fr\">ce lien</a>.</p></div>";
        let md = html_to_markdown(html);
        assert!(md.contains("Bonjour **le** *monde* & l'IA."), "got: {md}");
        assert!(md.contains("- un") && md.contains("- deux"), "got: {md}");
        assert!(md.contains("[ce lien](https://ex.fr)"), "got: {md}");
        assert!(!md.contains('<'), "reste des balises : {md}");
    }

    #[test]
    fn md_headings_entities() {
        let md = html_to_markdown("<h2>Titre</h2><p>caf&eacute; &laquo;&nbsp;test&nbsp;&raquo;</p>");
        assert!(md.contains("## Titre"), "got: {md}");
        assert!(md.contains("café"), "got: {md}");
        assert!(md.contains("« test »"), "got: {md}");
    }

    #[test]
    fn md_link_without_href_drops_brackets() {
        let md = html_to_markdown("<p>x <a>y</a> z</p>");
        assert!(md.contains("x y z"), "got: {md}");
        assert!(!md.contains('['), "got: {md}");
    }

    #[test]
    fn md_empty() {
        assert_eq!(html_to_markdown("   "), "");
        assert_eq!(html_to_markdown(""), "");
    }

    // Revue Lot 3 #1/#4/#8 : un « < » littéral (inégalité) ne doit PAS tronquer le texte.
    #[test]
    fn md_literal_lt_preserved() {
        let md = html_to_markdown("Garder si 3 < 5 sinon rejeter. Fin.");
        assert!(md.contains("3 < 5 sinon rejeter. Fin."), "got: {md}");
        let md2 = html_to_markdown("a < b puis <strong>gras</strong> fin");
        assert!(md2.contains("a < b puis **gras** fin"), "got: {md2}");
        let md3 = html_to_markdown("texte <"); // '<' final orphelin
        assert!(md3.contains("texte <"), "got: {md3}");
    }

    // Revue Lot 3 #3 : un « > » dans une valeur d'attribut ne termine pas la balise.
    #[test]
    fn md_attr_with_gt_no_leak() {
        let md = html_to_markdown("<span data-note=\"a>b\">contenu visible</span>");
        assert_eq!(md, "contenu visible", "got: {md}");
        let md2 = html_to_markdown("<strong data-x=\"3>2\">gras</strong> normal");
        assert!(md2.contains("**gras** normal") && !md2.contains('>'), "got: {md2}");
    }

    // Revue Lot 3 #6 : éléments inline vides → aucun marqueur orphelin.
    #[test]
    fn md_empty_inline_no_dirt() {
        assert_eq!(html_to_markdown("<strong></strong>"), "");
        assert_eq!(html_to_markdown("<em></em>"), "");
        assert_eq!(html_to_markdown("<code></code>"), "");
        assert_eq!(html_to_markdown("<a href=\"http://x.fr\"></a>"), "");
        assert!(!html_to_markdown("ok <strong></strong> fin").contains('*'));
    }
}
