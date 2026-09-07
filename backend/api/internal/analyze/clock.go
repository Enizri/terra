package analyze

import (
	"fmt"
	"strings"
	"time"

	"github.com/Enizri/terra/backend/api/internal/job"
)

// stageClock records where a run's seconds went.
//
// Terra's whole promise is a readable map in seconds, so "which stage cost
// what" has to be something an operator reads off a log line and the browser
// can show — not something the next person rediscovers with a profiler. Every
// event carries the elapsed time since the run started, and the run ends with
// one summary line naming each stage.
type stageClock struct {
	start  time.Time
	mark   time.Time
	stages []job.StageTiming
}

func newClock() *stageClock {
	now := time.Now()
	return &stageClock{start: now, mark: now}
}

// stop closes the stage that has been running since the last stop and returns
// how long it took. A zero-length stage is still recorded: an unexpectedly
// absent cost is as informative as a large one.
func (c *stageClock) stop(stage string) time.Duration {
	now := time.Now()
	d := now.Sub(c.mark)
	c.mark = now
	c.stages = append(c.stages, job.StageTiming{Stage: stage, Millis: d.Milliseconds()})
	return d
}

// skip drops the time since the last mark without recording a stage, so a
// stage that did not run cannot be charged to the one that follows it.
func (c *stageClock) skip() { c.mark = time.Now() }

func (c *stageClock) elapsed() time.Duration { return time.Since(c.start) }

// summary renders the stages as one log line: "scan=0.6s analyze=31.2s …".
func (c *stageClock) summary() string {
	parts := make([]string, 0, len(c.stages)+1)
	for _, s := range c.stages {
		parts = append(parts, fmt.Sprintf("%s=%s", s.Stage, round(time.Duration(s.Millis)*time.Millisecond)))
	}
	parts = append(parts, "total="+round(c.elapsed()))
	return strings.Join(parts, " ")
}

// round trims a duration to a tenth of a second — the resolution anyone
// reading a progress log actually acts on.
func round(d time.Duration) string {
	return d.Round(100 * time.Millisecond).String()
}
