# H3 reference editing compatibility

The shared video editor preserves two separate modes for standard MiniMax H3 cards: first/last frame and multi-image reference. Existing cards default to first/last frame. Switching modes does not replace the original images or the first/last-frame prompt.

Multi-image editing accepts 1–9 original images in one reference shelf. The picture mention editor supports inline and expanded editing. Removing a reference renumbers mentions, preserves the library original, and persists the removal across reloads. References are ordered and converted to `<Picture N>` at the submission boundary. Temporary image URLs, duplicate references, out-of-range mentions, and mixed first/last-frame or long-video parameters are rejected.

The public source edition includes shared editing and persistence compatibility only. It does not include local model execution, agents, GPU workflows, model weights or operator verification tools. A historical card being editable does not mean its local model is available for generation. No fallback from multi-image reference to first/last frame is permitted.

`h3ReferenceMode` and `h3ReferenceContent` belong to the task group and merged-card snapshot. Existing first/last-frame prompt and source fields remain unchanged. These fields do not grant local execution capability in the public edition.
