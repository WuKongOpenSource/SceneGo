# Video model selection and legacy records

The new-task capability manifest and selectors offer H3 standard, Fast and Mini
as the supported local profiles. Each profile still requires its own live
capability readiness; retirement does not make an unavailable H3 node available.

Legacy local keys remain in the persisted video model type, display-name mapping
and task readers. They are excluded even if an old capability response, custom
fallback list or restored selection includes them. The selector asks the user to
choose an available model and does not mutate a historical card or silently
switch to a paid online provider. The existing submission availability guard
continues to reject a card whose model is absent from the offered catalog.

This changes no worker configuration, workflow files, task state, billing,
notifications or stored outputs. No node update or restart is required.
