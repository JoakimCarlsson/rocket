package engineer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/joakimcarlsson/ai/llm"
	"github.com/joakimcarlsson/ai/message"
	"github.com/joakimcarlsson/ai/schema"
)

// ID names the hosted engineer to the web app, which shows it as the
// provider that answered.
const ID = "openrouter"

// interpretation is what one turn returns. Every field is required but
// nullable, because strict structured outputs allow nothing else; the web app
// drops the nulls.
type interpretation struct {
	Response string   `json:"response" desc:"One or two short in-character sentences saying what was changed."`
	Name     *string  `json:"name"     desc:"A short funny ALL-CAPS name, only while the rocket is still called UNTITLED VEHICLE."`
	Actions  []action `json:"actions"  desc:"The modifications to apply to the current rocket, in order."`
}

// action is one modification. Which fields mean anything depends on Type;
// the rest are null.
type action struct {
	Type     string   `json:"type"`
	Name     *string  `json:"name"`
	Value    *string  `json:"value"`
	Target   *string  `json:"target"`
	ID       *string  `json:"id"`
	IDs      []string `json:"ids,omitempty"`
	Kind     *string  `json:"kind"`
	Attach   *string  `json:"attach"`
	Position *string  `json:"position"`
	Size     *string  `json:"size"`
	Style    *string  `json:"style"`
	Shape    *string  `json:"shape"`
	Color    *string  `json:"color"`
	Count    *float64 `json:"count"`
	Crew     *float64 `json:"crew"`
	Power    *float64 `json:"power"`
	Height   *float64 `json:"height"`
	Width    *float64 `json:"width"`
	Radius   *float64 `json:"radius"`
	Degrees  *float64 `json:"degrees"`
}

// interpretationSchema constrains the call, derived from the struct so the
// two cannot drift.
var interpretationSchema = schema.NewStructuredOutputFromStruct(
	"rocket_actions",
	"The modifications the engineer makes to the current rocket.",
	interpretation{},
)

// Engineer answers player turns with a hosted model.
type Engineer struct {
	llm llm.LLM
}

// New returns an engineer that talks to client.
func New(client llm.LLM) *Engineer {
	return &Engineer{llm: client}
}

// Label is the model's display name, e.g. "SEED 2.0 MINI" for
// bytedance-seed/seed-2.0-mini.
func (e *Engineer) Label() string {
	id := e.llm.Model().APIModel
	if i := strings.LastIndex(id, "/"); i >= 0 {
		id = id[i+1:]
	}
	return strings.ToUpper(strings.ReplaceAll(id, "-", " "))
}

// Interpret sends one user turn, already built by the web app from the
// rocket, recent history and instruction, and returns the model's JSON as-is.
func (e *Engineer) Interpret(
	ctx context.Context,
	turn string,
) (json.RawMessage, error) {
	resp, err := e.llm.SendMessagesWithStructuredOutput(
		ctx,
		[]message.Message{
			message.NewSystemMessage(systemPrompt),
			message.NewUserMessage(turn),
		},
		nil,
		interpretationSchema,
	)
	if err != nil {
		return nil, err
	}

	slog.InfoContext(ctx, "llm usage",
		"call", "interpret",
		"in", resp.Usage.InputTokens,
		"out", resp.Usage.OutputTokens,
		"reasoning", resp.Usage.ReasoningTokens,
	)

	raw := resp.Content
	if resp.StructuredOutput != nil {
		raw = *resp.StructuredOutput
	}
	if raw == "" {
		return nil, errors.New("empty response")
	}
	if !json.Valid([]byte(raw)) {
		return nil, fmt.Errorf("response is not JSON: %.200s", raw)
	}
	return json.RawMessage(raw), nil
}
