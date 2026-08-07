package server

import "testing"

func TestLoopbackAddr(t *testing.T) {
	cases := []struct {
		addr string
		want bool
	}{
		{":8080", false},
		{"0.0.0.0:8080", false},
		{"[::]:8080", false},
		{"127.0.0.1:8080", true},
		{"127.0.0.53:8080", true},
		{"localhost:8080", true},
		{"[::1]:8080", true},
		{"192.168.1.5:8080", false},
		{"garbage", false},
	}
	for _, c := range cases {
		if got := LoopbackAddr(c.addr); got != c.want {
			t.Errorf("LoopbackAddr(%q) = %v, want %v", c.addr, got, c.want)
		}
	}
}
