package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Ports that Docker containers publish on the host, read from their config
// on disk rather than from the Docker API.
//
// A free port is not necessarily an available one: at boot the agent can
// run before Docker has started the containers that publish it. That is how
// pdns-internal took 127.0.0.1:8090 on a host where Stalwart publishes it,
// and the mail server then failed to start ("address already in use").
// The Docker API is no help at that moment (it doesn't answer until every
// container has been started), but each container's hostconfig.json is on
// disk from the start.

var dockerContainersDir = "/var/lib/docker/containers"

type dockerHostConfig struct {
	PortBindings map[string][]struct {
		HostIP   string `json:"HostIp"`
		HostPort string `json:"HostPort"`
	} `json:"PortBindings"`
	RestartPolicy struct {
		Name string `json:"Name"`
	} `json:"RestartPolicy"`
}

// dockerReservedLoopbackTCPPorts maps each TCP host port that a container
// publishes on loopback or on every address to that container's name. Those
// are the bindings that collide with a service listening on 127.0.0.1.
// Containers with restart policy "no" are skipped: Docker won't start them
// on its own, so they don't claim their port at boot.
func dockerReservedLoopbackTCPPorts() map[int]string {
	reserved := map[int]string{}
	dirs, err := os.ReadDir(dockerContainersDir)
	if err != nil {
		return reserved
	}
	for _, dir := range dirs {
		if !dir.IsDir() {
			continue
		}
		base := filepath.Join(dockerContainersDir, dir.Name())
		data, err := os.ReadFile(filepath.Join(base, "hostconfig.json"))
		if err != nil {
			continue
		}
		var cfg dockerHostConfig
		if json.Unmarshal(data, &cfg) != nil {
			continue
		}
		if policy := cfg.RestartPolicy.Name; policy == "" || policy == "no" {
			continue
		}
		name := dockerContainerName(base, dir.Name())
		for containerPort, bindings := range cfg.PortBindings {
			if !strings.HasSuffix(containerPort, "/tcp") {
				continue
			}
			for _, binding := range bindings {
				if !bindsLoopback(binding.HostIP) {
					continue
				}
				if port, err := strconv.Atoi(binding.HostPort); err == nil && port > 0 {
					reserved[port] = name
				}
			}
		}
	}
	return reserved
}

func bindsLoopback(hostIP string) bool {
	switch strings.TrimSpace(hostIP) {
	case "", "0.0.0.0", "::", "127.0.0.1":
		return true
	}
	return false
}

func dockerContainerName(base, id string) string {
	var cfg struct {
		Name string `json:"Name"`
	}
	if data, err := os.ReadFile(filepath.Join(base, "config.v2.json")); err == nil && json.Unmarshal(data, &cfg) == nil {
		if name := strings.TrimPrefix(cfg.Name, "/"); name != "" {
			return name
		}
	}
	if len(id) > 12 {
		id = id[:12]
	}
	return "conteneur " + id
}
