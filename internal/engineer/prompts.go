package engineer

import (
	_ "embed"
	"strings"
)

// systemPromptFile is the stable instruction every turn is sent with.
//
//go:embed prompts/system.md
var systemPromptFile string

// systemPrompt is systemPromptFile without the trailing newline an editor
// leaves at the end of the file.
var systemPrompt = strings.TrimSpace(systemPromptFile)
