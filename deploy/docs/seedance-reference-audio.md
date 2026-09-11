# Seedance reference audio

## User behavior

Under the video card's sound settings, `仅裁剪参考副本至 15 秒内` is an
explicit opt-in. Without it, an over-limit reference is rejected before credits
are reserved. Original audio, dialogue, merged-card metadata, historical results,
and finished-film audio are never rewritten by this option.

Seedance 2.0 accepts at most three WAV/MP3 reference clips. Each must be at least
2 seconds; their combined duration must not exceed 15 seconds. Reference duration
and the requested output video duration are separate constraints.

When enabled and necessary, retain each reference's opening at normal speed:
allocate the 15-second budget proportionally to original duration, with a
2-second minimum per reference. Fix any under-minimum allocation at 2 seconds,
then redistribute the remaining budget proportionally. Floor allocations to
milliseconds. A source shorter than 2 seconds is rejected, never stretched.

For example, 15.804 and 8.028 seconds become 9.947 and 5.052 seconds (14.999 seconds
total). This is still one video task, not multiple video segments to stitch.
The reference no longer contains the entire spoken passage; use the retained
full dubbing separately when the finished film requires every line.

## Boundaries and persistence

- `reference_audio_policy` is `preserve` by default, or explicit `trim_to_15`.
  Unknown values are rejected. Existing tasks without the field retain their
  previous input policy; there is no migration or historical-data rewrite.
- Client duration metadata is only a display hint. Both public and mixed-runtime
  submission services authorize referenced files and probe real bytes before
  reserving credits or enqueueing work.
- The worker reauthorizes and reprobes the source. Only at the provider send
  boundary does it create temporary PCM WAV copies when trimming is necessary.
  The copies are reprobed and sent inline, so remote URL changes cannot replace
  already-verified bytes. Temporary files are removed after processing.
- All original references remain in task data; no derivative file record,
  workspace item, extra video task, or extra generation charge is created.
- Private-address downloads, redirects, unsupported formats, unreadable media,
  and oversized files fail closed. FFmpeg and FFprobe must be installed.
- Invalid audio and provider `InvalidParameter` rejections stop automatic retry
  without marking a provider unhealthy. Existing failure settlement is reused.
- Agent Plan compatibility tasks are outside this Seedance 2.0 audio policy.

## Regression coverage

`tests/test_seedance_audio_validation.py` exercises real WAV probes, forged
metadata, access checks, public/mixed preflight before credit reservation,
proportional allocation, exact PCM-prefix comparison, immutable task inputs,
and a single mocked provider submission for standard, fast, and mini models.
Frontend audio utility, service, and panel tests cover policy defaults, displayed
budgets, explicit opt-in, and unchanged media inputs. Tests do not issue paid
provider calls.

Reference: [Seedance multimodal requirements](https://docs.byteplus.com/en/docs/byteplus_las/video_gen_enhanced).
