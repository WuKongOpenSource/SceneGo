# Image history expiry display

Source revision: `d8d2bdd03d453b7a3a285f03fceebfbbea1e7073`.

Completed image-upscale history now shows the retention deadline independently
of the local-delivery notice. An explicit result expiry takes precedence; older
records use the completion time, or creation time if necessary, plus 30 days.
Records with no valid timestamp show an unknown-expiry notice instead of a
fabricated date. Missing download URLs remain disabled.

This is a shared presentation-only fix. It does not enable local processing in
the public edition or change task execution, billing, file retention, cleanup,
download authorization, or persisted results.

Coverage includes local-delivery records, explicit expiry, legacy timestamps,
missing dates, ordinary downloads, and running or failed tasks.
