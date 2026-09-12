# Reliable final-video publishing

Concatenation, music mixing and subtitle rendering finish in the job's scratch
directory before the output is published. If scratch and persistent storage are
on different filesystems, the completed video is copied in bounded chunks into a
temporary file on the destination filesystem, flushed, then atomically renamed.
An interrupted or failed copy cannot replace an existing result with partial data.
File permissions are preserved and temporary publishing files are cleaned up.
The blocking copy runs outside the request event loop.

Composition errors returned by status and preflight APIs contain only safe,
actionable text. Detailed exceptions, source paths and encoder diagnostics stay in
server logs. The frontend additionally hides raw paths from cached legacy errors.
