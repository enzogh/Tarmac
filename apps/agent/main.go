package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

type heartbeat struct {
	NodeID  string      `json:"nodeId"`
	Metrics metricState `json:"metrics"`
}

type metricState struct {
	CPU       float64 `json:"cpu"`
	RAM       float64 `json:"ram"`
	Disk      float64 `json:"disk"`
	NetworkRx float64 `json:"networkRx"`
	NetworkTx float64 `json:"networkTx"`
	IORead    float64 `json:"ioRead"`
	IOWrite   float64 `json:"ioWrite"`
}

type diskState struct {
	Name       string `json:"name"`
	MountPath  string `json:"mountPath"`
	Type       string `json:"type"`
	Health     string `json:"health"`
	CapacityGb int    `json:"capacityGb"`
	UsedGb     int    `json:"usedGb"`
}

type smartState struct {
	DiskName           string `json:"diskName"`
	TemperatureC       int    `json:"temperatureC"`
	ReallocatedSectors int    `json:"reallocatedSectors"`
	PendingSectors     int    `json:"pendingSectors"`
	PowerOnHours       int    `json:"powerOnHours"`
	Overall            string `json:"overall"`
}

type stateReport struct {
	NodeID       string       `json:"nodeId"`
	Disks        []diskState  `json:"disks"`
	SmartReports []smartState `json:"smartReports"`
}

type envelope struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload,omitempty"`
}

type commandPayload struct {
	Type    string                 `json:"type"`
	Payload map[string]interface{} `json:"payload"`
}

type commandResult struct {
	Command      string `json:"command"`
	ResourceType string `json:"resourceType"`
	ResourceID   string `json:"resourceId"`
	Success      bool   `json:"success"`
	Message      string `json:"message,omitempty"`
}

func envOrDefault(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func sendJSON(conn *websocket.Conn, v interface{}) error {
	return conn.WriteJSON(v)
}

func randomHealth() string {
	values := []string{"healthy", "healthy", "healthy", "warning"}
	return values[rand.Intn(len(values))]
}

func buildStateReport(nodeID string) stateReport {
	used1 := 120 + rand.Intn(320)
	used2 := 60 + rand.Intn(180)
	return stateReport{
		NodeID: nodeID,
		Disks: []diskState{
			{Name: "sda", MountPath: "/data", Type: "ssd", Health: randomHealth(), CapacityGb: 512, UsedGb: used1},
			{Name: "sdb", MountPath: "/backup", Type: "hdd", Health: randomHealth(), CapacityGb: 1024, UsedGb: used2},
		},
		SmartReports: []smartState{
			{DiskName: "sda", TemperatureC: 35 + rand.Intn(8), ReallocatedSectors: rand.Intn(3), PendingSectors: 0, PowerOnHours: 3000 + rand.Intn(500), Overall: "healthy"},
			{DiskName: "sdb", TemperatureC: 33 + rand.Intn(7), ReallocatedSectors: rand.Intn(6), PendingSectors: rand.Intn(2), PowerOnHours: 5000 + rand.Intn(800), Overall: randomHealth()},
		},
	}
}

func main() {
	rand.Seed(time.Now().UnixNano())
	controlPlane := envOrDefault("CONTROL_PLANE_WS", "ws://localhost:3001/agents-ws")
	token := envOrDefault("AGENT_TOKEN", "agent-secret")
	nodeID := envOrDefault("NODE_ID", "node-local")

	u, err := url.Parse(controlPlane)
	if err != nil {
		log.Fatalf("invalid CONTROL_PLANE_WS: %v", err)
	}

	q := u.Query()
	q.Set("token", token)
	q.Set("nodeId", nodeID)
	u.RawQuery = q.Encode()

	log.Printf("connecting to %s", u.String())
	conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		log.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, syscall.SIGINT, syscall.SIGTERM)

	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			var msg envelope
			if err := conn.ReadJSON(&msg); err != nil {
				log.Printf("read error: %v", err)
				return
			}

			if msg.Type != "command" {
				continue
			}

			raw, _ := json.Marshal(msg.Payload)
			var cmd commandPayload
			if err := json.Unmarshal(raw, &cmd); err != nil {
				continue
			}

			result := commandResult{Success: true, Message: "simulated success"}
			switch cmd.Type {
			case "command.apply_export":
				result.Command = "apply_export"
				result.ResourceType = "share"
				if id, ok := cmd.Payload["shareId"].(string); ok {
					result.ResourceID = id
				}
			case "command.apply_mount":
				result.Command = "apply_mount"
				result.ResourceType = "mount"
				if id, ok := cmd.Payload["mountId"].(string); ok {
					result.ResourceID = id
				}
			case "command.apply_pool":
				result.Command = "apply_pool"
				result.ResourceType = "pool_member"
				poolID, _ := cmd.Payload["poolId"].(string)
				nodeIDPayload, _ := cmd.Payload["nodeId"].(string)
				if poolID != "" && nodeIDPayload != "" {
					result.ResourceID = fmt.Sprintf("%s:%s", poolID, nodeIDPayload)
				}
			case "command.run_rsync":
				result.Command = "run_rsync"
				result.ResourceType = "sync_job_run"
				if runID, ok := cmd.Payload["runId"].(string); ok {
					result.ResourceID = runID
				}
				result.Message = "simulated rsync completed"
			default:
				result.Success = false
				result.Message = fmt.Sprintf("unknown command %s", cmd.Type)
			}

			_ = sendJSON(conn, envelope{Type: "command_result", Payload: result})
		}
	}()

	heartbeatTicker := time.NewTicker(15 * time.Second)
	stateTicker := time.NewTicker(30 * time.Second)
	defer heartbeatTicker.Stop()
	defer stateTicker.Stop()

	sendHeartbeat := func() {
		hb := heartbeat{
			NodeID: nodeID,
			Metrics: metricState{
				CPU:       5 + rand.Float64()*65,
				RAM:       20 + rand.Float64()*60,
				Disk:      30 + rand.Float64()*50,
				NetworkRx: 20 + rand.Float64()*120,
				NetworkTx: 10 + rand.Float64()*90,
				IORead:    40 + rand.Float64()*200,
				IOWrite:   20 + rand.Float64()*140,
			},
		}
		if err := sendJSON(conn, envelope{Type: "agent.heartbeat", Payload: hb}); err != nil {
			log.Printf("heartbeat send failed: %v", err)
		}
	}

	sendStateReport := func() {
		report := buildStateReport(nodeID)
		if err := sendJSON(conn, envelope{Type: "agent.state_report", Payload: report}); err != nil {
			log.Printf("state report send failed: %v", err)
		}
	}

	sendHeartbeat()
	sendStateReport()
	for {
		select {
		case <-done:
			return
		case <-heartbeatTicker.C:
			sendHeartbeat()
		case <-stateTicker.C:
			sendStateReport()
		case <-interrupt:
			_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "shutdown"))
			return
		}
	}
}
