package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// agentDeployKeyPath is the SSH key this node clones and updates the
// repository with (installed by the onboarding, see
// node-onboarding.service.ts). "" when the home directory is unknown.
func agentDeployKeyPath() string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return envOrDefault("AGENT_DEPLOY_KEY_PATH", "")
	}
	return envOrDefault("AGENT_DEPLOY_KEY_PATH", filepath.Join(homeDir, ".ssh", "tarmac_deploy_ed25519"))
}

var deployKeyCache struct {
	sync.Mutex
	value string
	at    time.Time
}

// deployKeyPublic is the public half of the deploy key, reported in each
// heartbeat so the control plane can match it with the repository's deploy
// keys on GitHub (and remove it there when the node is deleted). Never the
// private key. Cached: the key only changes when a node is re-enrolled.
func deployKeyPublic() string {
	deployKeyCache.Lock()
	defer deployKeyCache.Unlock()
	if time.Since(deployKeyCache.at) < 10*time.Minute {
		return deployKeyCache.value
	}
	deployKeyCache.at = time.Now()
	deployKeyCache.value = ""
	path := agentDeployKeyPath()
	if path == "" {
		return ""
	}
	if data, err := os.ReadFile(path + ".pub"); err == nil {
		deployKeyCache.value = strings.TrimSpace(string(data))
		return deployKeyCache.value
	}
	// The .pub may be gone while the private key is still there.
	if _, err := os.Stat(path); err == nil && commandExists("ssh-keygen") {
		if out, err := exec.Command("ssh-keygen", "-y", "-f", path).Output(); err == nil {
			deployKeyCache.value = strings.TrimSpace(string(out))
		}
	}
	return deployKeyCache.value
}
