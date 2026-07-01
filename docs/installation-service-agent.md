# Installation du service agent (Ubuntu 22.04)

Ce guide installe l'agent Tarmac en **service systemd** avec **auto-restart**.

## 1) Prérequis

- Un serveur Ubuntu 22.04
- Un nœud déjà créé dans Tarmac (vous avez son `nodeId`)
- Le token partagé API (`AGENT_SHARED_TOKEN`)
- L'URL WebSocket du control-plane (ex: `ws://IP_API:3001/agents-ws`)

## 2) Installation en une commande

```bash
curl -fsSL https://raw.githubusercontent.com/enzogh/Tarmac/main/apps/agent/scripts/install-agent-service.sh | sudo bash -s -- \
  --node-id "<NODE_ID>" \
  --control-plane-ws "ws://<API_HOST>:3001/agents-ws" \
  --agent-token "<AGENT_SHARED_TOKEN>"
```

Le script :

- installe automatiquement les dépendances (`golang-go`, `nfs-common`, `cifs-utils`, `util-linux`, etc.)
- compile le binaire `tarmac-agent`
- crée le service `tarmac-agent.service`
- active le démarrage automatique et le redémarrage automatique (`Restart=always`)

## 3) Vérification

```bash
sudo systemctl status tarmac-agent --no-pager
sudo journalctl -u tarmac-agent -f
```

## 4) Fichiers installés

- Service systemd : `/etc/systemd/system/tarmac-agent.service`
- Variables d'environnement : `/etc/tarmac-agent.env`
- Binaire : `/usr/local/bin/tarmac-agent`

## 5) Commandes utiles

```bash
sudo systemctl restart tarmac-agent
sudo systemctl stop tarmac-agent
sudo systemctl start tarmac-agent
sudo systemctl disable tarmac-agent
sudo systemctl enable tarmac-agent
```

## 6) Mettre à jour l'agent

Relancer simplement la commande d'installation (section 2), puis :

```bash
sudo systemctl daemon-reload
sudo systemctl restart tarmac-agent
```

## 7) Désinstallation

```bash
sudo systemctl stop tarmac-agent
sudo systemctl disable tarmac-agent
sudo rm -f /etc/systemd/system/tarmac-agent.service
sudo rm -f /etc/tarmac-agent.env
sudo rm -f /usr/local/bin/tarmac-agent
sudo systemctl daemon-reload
```
