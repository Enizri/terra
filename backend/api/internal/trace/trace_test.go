package trace

import (
	"strconv"
	"testing"
	"time"
)

func span(repo, path string) Span {
	return Span{Repo: repo, Time: time.Now(), Method: "GET", Path: path, Status: 200}
}

func TestPublishFansOutToMatchingRepoOnly(t *testing.T) {
	_, a, cancelA := Subscribe("repo-a")
	defer cancelA()
	_, b, cancelB := Subscribe("repo-b")
	defer cancelB()

	Publish(span("repo-a", "/api/x"))

	select {
	case s := <-a:
		if s.Path != "/api/x" {
			t.Errorf("span = %+v", s)
		}
	case <-time.After(time.Second):
		t.Fatal("subscriber for repo-a got nothing")
	}
	select {
	case s := <-b:
		t.Errorf("repo-b must not receive repo-a spans, got %+v", s)
	default:
	}
}

func TestSubscribeReplaysRing(t *testing.T) {
	repo := "repo-replay"
	for i := 0; i < keep+10; i++ {
		Publish(span(repo, "/req/"+strconv.Itoa(i)))
	}
	history, _, cancel := Subscribe(repo)
	defer cancel()
	if len(history) != keep {
		t.Fatalf("history = %d spans, want ring capped at %d", len(history), keep)
	}
	if history[len(history)-1].Path != "/req/"+strconv.Itoa(keep+9) {
		t.Errorf("last replayed span = %q, want the newest", history[len(history)-1].Path)
	}
}

func TestSlowSubscriberDropsInsteadOfBlocking(t *testing.T) {
	_, ch, cancel := Subscribe("repo-slow")
	defer cancel()
	done := make(chan struct{})
	go func() {
		for i := 0; i < 500; i++ { // far past the channel buffer
			Publish(span("repo-slow", "/x"))
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Publish blocked on a slow subscriber")
	}
	_ = ch
}

func TestCancelIsIdempotent(t *testing.T) {
	_, _, cancel := Subscribe("repo-c")
	cancel()
	cancel() // second close must not panic
}
