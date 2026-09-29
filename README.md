# Resumate

Resumate est une application de gestion et de génération de CV ciblés. L'objectif n'est pas de produire un CV unique et figé, mais de centraliser les éléments d'un parcours professionnel dans une base personnelle réutilisable, puis de composer rapidement un profil adapté à une offre, un client, un contexte de mission ou une cible métier.

Le produit s'adresse surtout aux profils qui accumulent beaucoup d'expériences, projets, compétences, diplômes, réalisations ou activités, et qui veulent éviter deux problèmes classiques : réécrire le même contenu à chaque candidature, ou envoyer un CV trop dense où les éléments importants sont noyés.

Resumate combine aujourd'hui une interface web Angular, un backend PocketBase, un serveur MCP Spring Boot et une couche de packaging desktop en cours de stabilisation. Le projet sert à la fois de base technique de développement, de socle pour une version hébergée managée et de fondation pour une distribution locale via application bundlée.

## État actuel

Resumate est actuellement en bêta fermée.

La version hébergée est disponible à l'adresse suivante :

```text
https://resumate.oai-lab.dev/
```

Cette instance n'est pas ouverte au public. Les inscriptions libres ne sont pas disponibles pour le moment et seuls des utilisateurs sélectionnés peuvent disposer d'un compte.

Le dépôt contient encore la base de développement actuelle, notamment la stack Docker, les migrations PocketBase, le frontend, le serveur MCP et les scripts de bootstrap. À terme, après l'intégration du paywall Stripe et la stabilisation de l'offre commerciale, le code source pourra passer en privé ou ce dépôt pourra rester public sous forme d'archive.

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Modes d'utilisation](#modes-dutilisation)
- [Architecture](#architecture)
- [Stack technique](#stack-technique)
- [Prérequis](#prérequis)
- [Démarrage rapide](#démarrage-rapide)
- [Installation locale](#installation-locale)
- [Configuration](#configuration)
- [Développement](#développement)
- [Vérification de production](#vérification-de-production)
- [MCP et intégration IA](#mcp-et-intégration-ia)
- [Données de démonstration](#données-de-démonstration)
- [Structure du projet](#structure-du-projet)
- [Pricing futur](#pricing-futur)
- [Roadmap](#roadmap)
- [Licence](#licence)

## Fonctionnalités

Resumate est construit autour d'une idée simple : séparer les matériaux de carrière du CV final.

- Gestion centralisée des expériences, projets, compétences, diplômes, hobbies et réalisations
- Création de profils CV à partir d'une sélection de matériaux existants
- Association d'un template visuel à chaque profil
- Gestion d'un slug public et d'une visibilité par profil
- Rendu public d'un CV via une route partageable
- Prévisualisation de plusieurs templates de CV
- Export PDF via l'impression navigateur
- Authentification et gestion des comptes via PocketBase
- Gestion de clés API MCP propres à chaque utilisateur
- Création assistée de profils ciblés par un agent compatible MCP
- Jeu de données de démonstration pour tester la stack localement

## Modes d'utilisation

### Version hébergée

La version hébergée correspond à l'expérience produit managée : l'utilisateur accède à Resumate depuis le web, sans installer PocketBase, Docker, Java ou le serveur MCP.

Statut actuel : bêta fermée.

- URL : `https://resumate.oai-lab.dev/`
- Accès : comptes réservés à des utilisateurs sélectionnés
- Inscriptions publiques : non disponibles pour le moment
- Objectif : stabiliser le produit, les templates, les flux de génération et les permissions avant une ouverture plus large

Cette version a vocation à devenir l'offre principale pour les utilisateurs qui veulent une solution prête à l'emploi, maintenue et disponible sans gestion d'infrastructure.

### Usage local et self-hosted

Le dépôt permet aujourd'hui de lancer une stack locale avec Docker Compose. Ce mode est utile pour développer, tester, itérer sur les templates et valider les intégrations.

L'objectif self-hosted côté produit n'est pas de promettre une distribution gratuite et ouverte du code source. La direction prévue est plutôt une application locale bundlée, capable d'embarquer les briques nécessaires pour exécuter Resumate sur la machine de l'utilisateur avec un minimum de configuration.

En pratique, la trajectoire locale est :

- stack Docker pour le développement et les tests techniques actuels
- packaging desktop en cours via Electrobun
- bundling de PocketBase, du frontend, du serveur MCP et d'un runtime Java adapté
- données locales conservées dans l'environnement utilisateur, pas dans les ressources applicatives

### Stack de développement

Le mode de développement actuel expose trois services principaux :

- frontend Angular pour l'interface privée et le rendu public des CV
- PocketBase pour l'authentification, les données métier, les fichiers et les règles d'accès
- serveur MCP Spring Boot pour les intégrations IA et la création de profils ciblés à partir des données existantes

## Architecture

Resumate est organisé autour de quatre couches.

### Application web (Angular)

L'application web (`apps/web`) sert à la fois d'interface d'administration et de moteur de rendu des CV publics.

Il couvre notamment :

- la connexion utilisateur
- la page d'accueil des profils
- l'éditeur de profil CV
- la gestion des matériaux de carrière
- la galerie de templates
- la gestion des tokens MCP
- les pages publiques de CV accessibles par slug
- les écrans dédiés au futur usage desktop

Les templates disponibles sont déclarés dans `apps/web/src/app/core/templates/cv-template-registry.ts`. Les templates actuels incluent `classic`, `bento`, `modern`, `supa` et `minimal`.

### Backend PocketBase

PocketBase fournit le socle backend :

- authentification
- collections métier
- relations entre profils, expériences, projets, compétences, diplômes, hobbies et réalisations
- stockage SQLite
- migrations et hooks
- règles d'accès pour les données privées et les CV publics

### Serveur MCP Spring Boot

Le serveur MCP expose des outils utilisables par un agent compatible afin de travailler sur les données CV sans manipuler directement les identifiants PocketBase de l'utilisateur.

Il permet notamment de :

- résoudre l'utilisateur associé à une clé API MCP
- lister les templates disponibles
- lister les matériaux réutilisables du profil
- créer un profil CV ciblé pour une offre ou un rôle donné

### Packaging desktop

Le dossier `apps/desktop/` prépare une application locale basée sur Electrobun.

Cette couche vise à empaqueter :

- le frontend Angular buildé
- le serveur MCP Java
- un runtime Java minimal
- PocketBase
- les ressources nécessaires à une exécution locale

Ce mode est encore en cours de stabilisation et s'inscrit dans la trajectoire self-hosted via application bundlée.

## Stack technique

- Angular 21
- PocketBase
- SQLite via PocketBase
- Spring Boot 4
- Spring AI MCP Server
- Java 17
- Docker Compose
- Electrobun
- Bun
- Jest
- Bootstrap Icons
- Masonry / ngx-masonry
- Quill / ngx-quill

## Prérequis

- Docker et Docker Compose pour lancer la stack complète localement
- Node.js 22+ ou Bun si vous travaillez directement sur le frontend
- Java 17+ si vous travaillez directement sur le serveur MCP ou le packaging desktop
- `make` pour utiliser les commandes de confort du dépôt

## Démarrage rapide

L'option la plus simple pour lancer la stack complète :

```bash
cp .env.example .env
# Editez .env et renseignez PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD avec des valeurs locales fortes.
docker compose --env-file .env -f docker/docker-compose.yml up -d
```

Services disponibles ensuite :

- Frontend : `${FRONTEND_BASE_URL}` avec `http://localhost:${FRONTEND_PORT:-4200}` par défaut
- PocketBase Admin : `${FRONTEND_BASE_URL}/_/` via le proxy frontend
- API PocketBase : `${FRONTEND_BASE_URL}/api/` via le proxy frontend
- MCP : `${MCP_PUBLIC_BASE_URL}/mcp` pour un déploiement public, ou `http://localhost:${MCP_PORT:-8081}/mcp` en local

PocketBase n'expose pas de port hôte par défaut dans Docker Compose. Le frontend nginx est le point d'entrée public pour l'admin et l'API PocketBase.

Le compte administrateur PocketBase doit être configuré explicitement via `PB_ADMIN_EMAIL` et `PB_ADMIN_PASSWORD`. Le dépôt ne fournit plus de mot de passe exécutable par défaut.

## Installation locale

### 1. Préparer l'environnement

Créez un fichier `.env` à partir de l'exemple si nécessaire :

```bash
cp .env.example .env
```

### 2. Lancer la stack

Avec Docker Compose :

```bash
docker compose --env-file .env -f docker/docker-compose.yml up -d
```

Le fichier `.env` vit à la racine du dépôt alors que les fichiers compose sont dans `docker/` ; le flag `--env-file .env` est donc nécessaire lorsque vous invoquez `docker compose` directement (les commandes `make` l'ajoutent déjà).

Ou avec les commandes `make` du projet :

```bash
make up
```

Pour initialiser aussi le compte de service MCP et redémarrer le service avec les credentials résolus :

```bash
make bootstrap
```

### 3. Vérifier les services

- Frontend : `${FRONTEND_BASE_URL}`
- PocketBase Admin : `${FRONTEND_BASE_URL}/_/`
- PocketBase API : `${FRONTEND_BASE_URL}/api/health`
- MCP : `${MCP_PUBLIC_BASE_URL}/mcp` en déploiement public, ou `http://localhost:${MCP_PORT:-8081}/mcp` en local

Si vous avez modifié les ports exposés dans `.env`, utilisez le port frontend configuré pour accéder à PocketBase via `/api/` et `/_/`.

## Configuration

Variables principales disponibles dans `.env` :

```env
PB_ADMIN_EMAIL=
PB_ADMIN_PASSWORD=
POCKETBASE_INTERNAL_PORT=8090
MCP_PORT=8081
MCP_INTERNAL_PORT=8081
FRONTEND_PORT=4200
FRONTEND_INTERNAL_PORT=4200
FRONTEND_BASE_URL=http://localhost:${FRONTEND_PORT:-4200}
POCKETBASE_SERVICE_USER_EMAIL=
POCKETBASE_SERVICE_USER_PASSWORD=
MCP_PUBLIC_BASE_URL=
MCP_OAUTH_JWK=
RESUMATE_AI_TOKEN=
SEED_USER_PASSWORD=
```

Description rapide :

- `PB_ADMIN_EMAIL` : email du super administrateur PocketBase
- `PB_ADMIN_PASSWORD` : mot de passe du super administrateur PocketBase
- `POCKETBASE_INTERNAL_PORT` : port interne écouté par PocketBase dans Docker, non publié sur l'hôte par défaut
- `MCP_PORT` : port hôte du serveur MCP, lié à `127.0.0.1` en production
- `MCP_INTERNAL_PORT` : port interne écouté par le serveur MCP dans Docker
- `FRONTEND_PORT` : port hôte du frontend Angular, lié à `127.0.0.1` en production
- `FRONTEND_INTERNAL_PORT` : port interne écouté par le serveur Angular dans Docker
- `FRONTEND_BASE_URL` : URL publique du frontend, utilisée notamment par le MCP
- `POCKETBASE_SERVICE_USER_EMAIL` : compte de service utilisé par le serveur MCP
- `POCKETBASE_SERVICE_USER_PASSWORD` : mot de passe du compte de service MCP
- `MCP_PUBLIC_BASE_URL` : URL HTTPS publique du serveur MCP séparé, sans le suffixe `/mcp`
- `MCP_OAUTH_JWK` : clé privée RSA JWK utilisée pour signer les tokens OAuth MCP
- `RESUMATE_AI_TOKEN` : jeton éventuel utilisé dans certains flux d'intégration

## Développement

### Commandes utiles

```bash
make env-init
make up
make down
make logs
make ps
make wait-pocketbase
make bootstrap
make bootstrap-with-seed
make mcp-up
make mcp-down
make mcp-logs
make ensure-mcp-service-user
make seed
make clean-seed
```

Comportement principal :

- `make env-init` : crée le fichier `.env` à partir de `.env.example` s'il n'existe pas
- `make up` : démarre la stack Docker
- `make wait-pocketbase` : attend que PocketBase réponde sur son endpoint de santé
- `make bootstrap` : initialise l'environnement, attend PocketBase, crée ou met à jour l'utilisateur de service MCP, puis démarre le service MCP
- `make bootstrap-with-seed` : exécute le bootstrap complet puis importe les données de démonstration
- `make seed` : importe les données de démonstration si les collections cibles sont vides
- `make clean-seed` : supprime uniquement les données de démonstration

### Frontend

L'application web Angular est située dans `apps/web/`.

Structure principale sous `apps/web/src/app/` :

- `pages/` : pages de route chargées via `app.routes.ts`
- `core/` : services, guards, modèles, utilitaires, données de preview et registre des templates
- `shared/components/` : composants UI réutilisables entre plusieurs templates ou écrans

Scripts disponibles :

```bash
cd apps/web
npm install
npm start
npm run build
npm test
```

Le serveur de développement Angular proxy les requêtes `/api` vers PocketBase afin de conserver un mode de fonctionnement proche de la production.

## Vérification de production

Avant un déploiement, utilisez les versions verrouillées des dépendances et exécutez la suite complète :

```bash
npm ci --prefix apps/web
bun install --frozen-lockfile --cwd apps/desktop
bun run test:all
cd apps/web && npm run build
```

La suite couvre les tests unitaires Angular, les tests desktop, les tests MCP et les tests Material MCP. Les workflows GitHub exécutent les contrôles frontend, desktop et MCP sur chaque pull request vers `dev` ou `main`.

Pour l'hébergement, configurez des valeurs uniques et secrètes pour `PB_ADMIN_PASSWORD`, `POCKETBASE_SERVICE_USER_PASSWORD` et `MCP_OAUTH_JWK`; ne publiez que le frontend et, si nécessaire, le MCP derrière HTTPS. PocketBase reste interne au réseau Docker par défaut.

### Déploiement Coolify (Docker Compose)

- Configurez les domaines HTTPS Coolify sur les **ports des conteneurs** : frontend `80`, MCP `${MCP_INTERNAL_PORT:-8081}`. PocketBase reste accessible uniquement aux autres conteneurs, sans domaine ni port hôte public. Vérifiez les routes réellement générées par Coolify avant de modifier les ports ; n'activez pas d'override Compose de développement ou une route « raw » vers les ports hôte.
- Les ports hôte `${FRONTEND_PORT:-4200}` et `${MCP_PORT:-8081}` sont liés à `127.0.0.1`. Confirmez la configuration effective sans afficher les variables secrètes :

  ```bash
  docker compose --env-file .env -f docker/docker-compose.yml config --format json \
    | jq -r '.services | to_entries[] | .key as $service | .value.ports[]? | "\($service): \(.host_ip):\(.published) -> \(.target)"'
  ```

- Le proxy frontend conserve `/api/` et le tableau de bord PocketBase `/_/` sur le domaine public : ce dernier **reste accessible avec le mot de passe administrateur**, conformément à la configuration actuelle. Utilisez des identifiants administrateur et MCP distincts, forts et uniques. Les CV publics, les téléchargements MCP non authentifiés des CV créés par MCP, et les routes OAuth/MCP doivent rester accessibles via leurs domaines HTTPS.
- Les fichiers téléversés (documents et images non publiées) ne sont téléchargeables que par leur propriétaire avec un jeton de fichier PocketBase à durée courte, ou par un superutilisateur. Sans connexion, seules les images liées à un CV `public=true` du même propriétaire sont téléchargeables. Les images privées de l'éditeur utilisent des URL à jeton court ; ne copiez pas ces URL dans des journaux ou des liens partagés. La publicité du CV créé par MCP est intentionnelle : toute personne disposant du lien peut consulter son contenu.

**Avant déploiement :** vérifiez la version PocketBase utilisée par l'image (actuellement `latest`) avec le hook `onFileDownloadRequest` et la validation des jetons ; faites une sauvegarde de `backend/pocketbase/pb_data` et préparez un retour à l'image/hooks précédents. Testez d'abord sur une instance isolée migrée avec `bash scripts/mcp-pocketbase-smoke.sh` (utilisez `CHECK_FILE_TOKEN_EXPIRY=1` pour vérifier aussi l'expiration selon la durée configurée par PocketBase). N'utilisez pas l'instance de production pour ce test : il crée temporairement comptes, CV et fichiers.

**Après déploiement :** depuis une autre machine, confirmez que les ports IP du serveur (`4200`/`8081` ou ceux configurés) ne répondent pas. Sur les domaines HTTPS, vérifiez `/api/health`, la connexion de l'utilisateur, un CV public avec ses images, le refus d'un CV privé sans connexion, le comportement d'authentification `/mcp` et de découverte OAuth, et la connexion administrateur via `/_/`. Vérifiez qu'une URL de document privé connue renvoie `404` sans connexion, qu'une image publiée répond `200` sans connexion et que le propriétaire peut toujours afficher une image privée dans l'éditeur. Les règles ne retirent pas les copies de fichiers qui auraient déjà été téléchargées avant ce changement.

### Templates CV

Le fichier `apps/web/src/app/core/templates/cv-template-registry.ts` est le point central qui déclare les templates disponibles :

- chaque entrée expose un `id`, un `label` et le composant Angular à rendre
- `CV_TEMPLATE_OPTIONS` alimente les listes de choix dans les écrans d'administration
- `CV_TEMPLATE_OPTIONS_BY_ID` permet à `CvShellPage` de résoudre dynamiquement le composant à afficher pour un profil donné

Le flux est le suivant :

1. Un profil CV stocke un identifiant de template comme `classic`, `bento`, `modern`, `supa` ou `minimal`.
2. Les écrans d'administration lisent le registre pour proposer uniquement les templates connus.
3. La route publique `/:slug` charge `CvShellPage`, qui récupère le profil puis sélectionne le composant correspondant depuis le registre.

Pour ajouter un nouveau template :

1. Créer une nouvelle page dans `pages/templates/`.
2. Ajouter l'entrée correspondante dans `cv-template-registry.ts`.
3. Réutiliser des composants `shared/components/` existants si possible.

### Desktop

Le dossier `apps/desktop/` contient le travail de packaging local.

Commandes principales :

```bash
bun run desktop:prepare
bun run desktop:dev
bun run desktop:build
bun run desktop:build:stable
bun run test:desktop
```

La préparation desktop construit le frontend, package le serveur MCP, prépare un runtime Java et récupère PocketBase pour la plateforme cible.

### Dev Container

Le dépôt inclut une configuration devcontainer/Codespaces orientée Docker. Elle permet de :

- démarrer automatiquement la stack complète
- attendre la disponibilité de PocketBase et du frontend
- exposer les ports définis par `FRONTEND_PORT` et `MCP_PORT`
- conserver les données PocketBase dans un dossier privé au workspace

Si vous devez relancer l'initialisation dans le conteneur :

```bash
bash .devcontainer/setup.sh
```

## MCP et intégration IA

Le dépôt inclut un serveur MCP local qui permet à un agent compatible de travailler sur les données CV d'un utilisateur sans exposer directement ses identifiants PocketBase.

Le service MCP permet notamment de :

- identifier l'utilisateur lié à une clé API MCP
- lister les templates disponibles
- récupérer les matériaux réutilisables d'un profil : expériences, projets, compétences, diplômes, hobbies, réalisations
- créer un profil CV public personnalisé pour une offre donnée

### Première configuration locale du MCP

```bash
make bootstrap
```

Équivalent détaillé si vous souhaitez exécuter les étapes séparément :

```bash
make up
make ensure-mcp-service-user
make mcp-up
```

Ensuite :

1. Connectez-vous à l'application avec le compte propriétaire des données CV.
2. Ouvrez la page de gestion des tokens MCP.
3. Créez une clé API MCP.
4. Injectez cette clé dans votre configuration locale d'agent si nécessaire.

Le fichier `opencode.json` du projet pointe vers l'endpoint MCP local par défaut. Si vous changez `MCP_PORT`, adaptez aussi cette URL dans votre configuration d'agent locale. En déploiement public, utilisez `${MCP_PUBLIC_BASE_URL}/mcp` comme valeur cible.

## Données de démonstration

Pour charger un jeu de données de preview :

```bash
make bootstrap-with-seed
```

Ou plus tard :

```bash
make seed
```

Le chargement est volontairement strict et échoue si les collections cibles ne sont pas vides.

Pour supprimer uniquement les données de démonstration :

```bash
make clean-seed
```

## Structure du projet

```text
.
├── apps/
│   ├── web/                  # Application Angular
│   ├── website/              # Réservé pour le futur site public
│   └── desktop/              # Packaging local Electrobun
├── backend/
│   ├── mcp/                  # Serveur MCP Spring Boot
│   └── pocketbase/
│       ├── Dockerfile
│       ├── hooks/            # Hooks PocketBase
│       └── migrations/       # Migrations PocketBase
├── docker/
│   ├── docker-compose.yml
│   ├── docker-compose.dev.yml
│   └── docker-compose.devcontainer.yml
├── backend/pocketbase/pb_data/  # Données locales PocketBase
├── scripts/                  # Scripts utilitaires et import seed
├── .devcontainer/            # Environnement Codespaces/devcontainer
├── Makefile                  # Commandes de confort
└── opencode.json             # Configuration MCP locale pour OpenCode
```

## Pricing futur

Le pricing n'est pas encore public et aucun tarif définitif n'est annoncé à ce stade.

La direction produit actuelle est la suivante :

- une offre hébergée payante, pensée pour les utilisateurs qui veulent Resumate prêt à l'emploi, maintenu et accessible depuis le web
- une distribution locale via application bundlée, pour exécuter Resumate sur sa propre machine sans assembler manuellement toute la stack
- une intégration Stripe à venir pour gérer le paywall, les accès et la transition vers l'offre commerciale

Après cette étape, le code source pourra devenir privé ou ce dépôt pourra rester public uniquement comme archive de la phase initiale du projet.

## Roadmap

Axes de travail prioritaires :

- stabiliser la bêta fermée hébergée sur `https://resumate.oai-lab.dev/`
- améliorer les règles d'accès, la séparation des données utilisateurs et les permissions MCP
- finaliser les flux de création de profils ciblés via MCP
- intégrer Stripe et formaliser le paywall
- stabiliser le packaging local via application bundlée
- améliorer la qualité visuelle et fonctionnelle des templates CV
- enrichir l'éditeur de matériaux de carrière et l'éditeur de profils
- clarifier la stratégie de distribution du code source après la phase bêta
- préparer une ouverture plus large une fois le produit, le pricing et l'infrastructure stabilisés

## Licence

Aucune licence explicite n'est actuellement définie dans ce dépôt.

Avant toute réutilisation, distribution ou exploitation commerciale, il est recommandé d'ajouter une licence formelle adaptée au modèle retenu pour la version hébergée, la distribution locale et l'avenir du dépôt source.
