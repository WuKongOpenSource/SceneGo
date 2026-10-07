# Seedance request-owned errors

When both PAYG and Agent Plan configurations are enabled, an error belongs to
the task's actual request channel, not the installation's current default.
Create and query failures retain their endpoint/model context, and wrapped
model-unavailable failures preserve the provider response. A model-not-found
response must not be rewritten into an unrelated Agent Plan quota message.
Unknown error ownership must not be guessed from a mutable default provider.

Source mapping: authoritative base revision
`a99817025b03f6dd47c5bd5902c5b5ee2b7dfccc`, accepted patch digest
`b566286edeabd939db06bbba4cc2d19965b57ae0c49741a0741800dfcb60fcc1`.
This public edition does not expose the separate Seedance 2.5 operation, so
the synchronization includes only the applicable shared request/error fix.
No production bindings, keys, operational scripts or generated media are
included. Existing model selection and billing contracts are unchanged.
