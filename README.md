# GL Code

Desktop client Electron pour chatter avec plusieurs agents IA dans une interface unifiée : **OpenClaw** (ton gateway IA sur VPS) et **Claude Code** (agent de coding Anthropic).

![Electron](https://img.shields.io/badge/Electron-33-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue) ![React](https://img.shields.io/badge/React-19-blue) ![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)

---

## Fonctionnalités

- Chat en streaming avec **OpenClaw** et **Claude Code** dans la même interface
- Tunnel SSH automatique vers ton VPS (géré par l'app, aucune commande manuelle)
- Persistance locale des conversations avec SQLite
- Intégration Git : status, diff, commit, push, création de PR GitHub
- Explorateur de fichiers et prévisualisation attachée aux projets
- Discord Rich Presence
- Barre de titre native Windows avec boutons Min/Max/Close

---

## Installation

Télécharge le fichier `GL-Code-Setup.exe` depuis la page [Releases](../../releases) et lance-le. L'installeur crée un raccourci dans le menu Démarrer et dans "Ajouter/Supprimer des programmes".

> **Note :** L'app n'est pas signée avec un certificat de code. Windows Defender SmartScreen peut afficher un avertissement au premier lancement — clique sur "Informations complémentaires" → "Exécuter quand même".

---

## Configuration

Au premier lancement, ouvre les **Réglages** (icône engrenage en bas de la sidebar) pour configurer les deux agents.

### Claude Code

Claude Code nécessite que le CLI Anthropic soit installé et authentifié sur ta machine.

1. Installe le CLI : `npm install -g @anthropic-ai/claude-code`
2. Authentifie-toi : `claude login`
3. Dans les Réglages de l'app, renseigne le **répertoire de travail** par défaut (le dossier dans lequel Claude Code exécutera ses commandes).

---

### OpenClaw

OpenClaw est un gateway IA qui tourne sur ton VPS. L'app s'y connecte via WebSocket, protégé par un tunnel SSH.

#### Prérequis

- Un VPS avec le gateway OpenClaw qui tourne sur le port `18789`
- Un accès SSH à ce VPS avec une clé privée (Ed25519 ou RSA)

#### Pourquoi un tunnel SSH ?

Le gateway OpenClaw auto-approuve les connexions qui arrivent depuis son propre loopback (`127.0.0.1`). En ouvrant un tunnel SSH, ta machine locale forward le port `18789` vers le loopback du VPS — tu es donc vu comme un client local, sans pairing de device ni pop-up d'autorisation.

#### Configuration dans l'app

Dans **Réglages → SSH / Tunnel**, remplis :

| Champ | Description | Exemple |
|---|---|---|
| **Host** | Adresse IP ou domaine de ton VPS | `mon-vps.example.com` |
| **Port** | Port SSH (défaut 22) | `22` |
| **User** | Nom d'utilisateur SSH | `ubuntu` |
| **Clé privée** | Chemin vers ta clé privée locale | `C:\Users\toi\.ssh\id_ed25519` |
| **Port local** | Port local du tunnel (défaut 18789) | `18789` |
| **Remote host** | Adresse du gateway côté VPS (défaut 127.0.0.1) | `127.0.0.1` |
| **Remote port** | Port du gateway côté VPS (défaut 18789) | `18789` |

Si ta clé est protégée par une passphrase, tu peux la renseigner dans **Réglages → Secrets** — elle est stockée chiffrée, jamais en clair.

#### Token d'authentification (optionnel)

Si ton gateway est configuré avec un token (`OPENCLAW_GATEWAY_TOKEN`), renseigne-le dans **Réglages → Secrets → Token OpenClaw**.

#### Mode repli (sans tunnel SSH)

Si tu ouvres déjà le tunnel toi-même (via un autre outil), désactive le tunnel dans les réglages (`SSH enabled = false`). L'app passera en mode "probe" : elle vérifie simplement que le port `127.0.0.1:18789` répond, sans gérer la connexion SSH.

#### Indicateur de connexion

L'état du tunnel est visible en temps réel dans la barre de statut en bas de l'app :
- 🟢 **Connected** — tunnel actif, OpenClaw joignable
- 🟡 **Connecting / Reconnecting** — tentative en cours (backoff exponentiel jusqu'à 30s)
- 🔴 **Down** — tunnel coupé, message d'erreur affiché

---

## Build depuis les sources

```bash
# Installer les dépendances
npm install

# Lancer en dev (hot-reload)
npm run dev

# Build de production + installeur Windows
npm run dist
```

L'installeur est généré dans `dist/`.

### Stack

- **Electron 33** — shell desktop
- **electron-vite** — bundler (Vite pour le renderer, esbuild pour le main)
- **React 19 + TypeScript** — UI renderer
- **better-sqlite3** — persistance locale
- **ssh2** — tunnel SSH natif Node (aucun binaire `ssh` requis)
- **openclaw-node** — client WebSocket pour le gateway OpenClaw

---

## Structure du projet

```
src/
  main/           # Processus Electron principal (Node)
    index.ts      # Point d'entrée, création de fenêtre
    ipc.ts        # Bridge IPC main ↔ renderer
    tunnel.ts     # Gestionnaire de tunnel SSH
    db.ts         # SQLite (conversations, messages, projets)
    adapters/     # Adaptateurs agents (OpenClaw, Claude Code)
  preload/        # Bridge contextBridge exposé au renderer
  renderer/       # UI React
    src/
      App.tsx
      components/
  shared/         # Types partagés main + renderer
```
