package main

import (
	"bufio"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
)

// What the machine is, alongside how busy it is: the dashboard only had
// percentages, so "RAM 54 %" said nothing about whether that was 2 GB or
// 128 GB, nor how many cores the CPU figure was spread over. Sent with every
// heartbeat; the static part (model, cores, OS) is read once.
type systemInfo struct {
	CPUModel       string    `json:"cpuModel,omitempty"`
	CPUThreads     int       `json:"cpuThreads"`
	CPUCores       int       `json:"cpuCores,omitempty"`
	CPUSockets     int       `json:"cpuSockets,omitempty"`
	CPUMHz         float64   `json:"cpuMhz,omitempty"`
	Load           []float64 `json:"load,omitempty"`
	MemTotalBytes  uint64    `json:"memTotalBytes,omitempty"`
	MemAvailBytes  uint64    `json:"memAvailableBytes,omitempty"`
	SwapTotalBytes uint64    `json:"swapTotalBytes,omitempty"`
	SwapFreeBytes  uint64    `json:"swapFreeBytes,omitempty"`
	OS             string    `json:"os,omitempty"`
	Kernel         string    `json:"kernel,omitempty"`
	Arch           string    `json:"arch,omitempty"`
	UptimeSec      int64     `json:"uptimeSec,omitempty"`
	Virtualization string    `json:"virtualization,omitempty"`
}

var (
	staticSystemOnce sync.Once
	staticSystem     systemInfo
)

func readStaticSystemInfo() systemInfo {
	staticSystemOnce.Do(func() {
		info := systemInfo{CPUThreads: runtime.NumCPU(), Arch: runtime.GOARCH}
		if file, err := os.Open("/proc/cpuinfo"); err == nil {
			physical := map[string]bool{}
			cores := map[string]bool{}
			var physicalID string
			scanner := bufio.NewScanner(file)
			for scanner.Scan() {
				key, value, ok := strings.Cut(scanner.Text(), ":")
				if !ok {
					continue
				}
				key, value = strings.TrimSpace(key), strings.TrimSpace(value)
				switch key {
				case "model name", "Model", "cpu model":
					if info.CPUModel == "" {
						info.CPUModel = strings.Join(strings.Fields(value), " ")
					}
				case "physical id":
					physicalID = value
					physical[value] = true
				case "core id":
					cores[physicalID+"/"+value] = true
				case "flags":
					if info.Virtualization == "" && strings.Contains(" "+value+" ", " hypervisor ") {
						info.Virtualization = "vm"
					}
				}
			}
			file.Close()
			info.CPUSockets = len(physical)
			info.CPUCores = len(cores)
		}
		if raw, err := os.ReadFile("/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq"); err == nil {
			if khz, err := strconv.ParseFloat(strings.TrimSpace(string(raw)), 64); err == nil {
				info.CPUMHz = khz / 1000
			}
		}
		if raw, err := os.ReadFile("/etc/os-release"); err == nil {
			for _, line := range strings.Split(string(raw), "\n") {
				if strings.HasPrefix(line, "PRETTY_NAME=") {
					info.OS = strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), `"`)
				}
			}
		}
		if raw, err := os.ReadFile("/proc/sys/kernel/osrelease"); err == nil {
			info.Kernel = strings.TrimSpace(string(raw))
		}
		staticSystem = info
	})
	return staticSystem
}

func collectSystemInfo() systemInfo {
	info := readStaticSystemInfo()
	if raw, err := os.ReadFile("/proc/loadavg"); err == nil {
		fields := strings.Fields(string(raw))
		for i := 0; i < 3 && i < len(fields); i++ {
			if value, err := strconv.ParseFloat(fields[i], 64); err == nil {
				info.Load = append(info.Load, value)
			}
		}
	}
	if raw, err := os.ReadFile("/proc/meminfo"); err == nil {
		for _, line := range strings.Split(string(raw), "\n") {
			fields := strings.Fields(line)
			if len(fields) < 2 {
				continue
			}
			kb, err := strconv.ParseUint(fields[1], 10, 64)
			if err != nil {
				continue
			}
			switch fields[0] {
			case "MemTotal:":
				info.MemTotalBytes = kb * 1024
			case "MemAvailable:":
				info.MemAvailBytes = kb * 1024
			case "SwapTotal:":
				info.SwapTotalBytes = kb * 1024
			case "SwapFree:":
				info.SwapFreeBytes = kb * 1024
			}
		}
	}
	if raw, err := os.ReadFile("/proc/uptime"); err == nil {
		if fields := strings.Fields(string(raw)); len(fields) > 0 {
			if seconds, err := strconv.ParseFloat(fields[0], 64); err == nil {
				info.UptimeSec = int64(seconds)
			}
		}
	}
	return info
}
