package catalog

import (
	"bufio"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

// Capabilities is what the Terra host can run locally. VRAMGB is not detected
// in v1 (0 means unknown) — RAM plus device is enough to filter the catalog.
type Capabilities struct {
	RAMGB  int    `json:"ram_gb"`
	Device string `json:"device"` // "mps" | "cuda" | "cpu"
	VRAMGB int    `json:"vram_gb,omitempty"`
}

// DetectHost reads total RAM and the inference device of this machine.
// Everything falls back rather than failing: an unknown host reports 0 GB,
// which only disables local entries.
func DetectHost() Capabilities {
	return Capabilities{RAMGB: totalRAMGB(), Device: detectDevice()}
}

func totalRAMGB() int {
	switch runtime.GOOS {
	case "darwin":
		out, err := exec.Command("sysctl", "-n", "hw.memsize").Output()
		if err != nil {
			return 0
		}
		bytes, err := strconv.ParseInt(strings.TrimSpace(string(out)), 10, 64)
		if err != nil {
			return 0
		}
		return int(bytes / (1 << 30))
	case "linux":
		f, err := os.Open("/proc/meminfo")
		if err != nil {
			return 0
		}
		defer f.Close()
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			kb, ok := strings.CutPrefix(sc.Text(), "MemTotal:")
			if !ok {
				continue
			}
			kb = strings.TrimSuffix(strings.TrimSpace(kb), " kB")
			n, err := strconv.ParseInt(strings.TrimSpace(kb), 10, 64)
			if err != nil {
				return 0
			}
			return int(n / (1 << 20))
		}
	}
	return 0
}

// detectDevice mirrors the analyzer's pick_device: TERRA_DEVICE wins, then
// Apple silicon, then an nvidia-smi that answers, else cpu.
func detectDevice() string {
	if d := strings.ToLower(strings.TrimSpace(os.Getenv("TERRA_DEVICE"))); d != "" && d != "auto" {
		return d
	}
	if runtime.GOOS == "darwin" && runtime.GOARCH == "arm64" {
		return "mps"
	}
	if path, err := exec.LookPath("nvidia-smi"); err == nil {
		if err := exec.Command(path, "-L").Run(); err == nil {
			return "cuda"
		}
	}
	return "cpu"
}
