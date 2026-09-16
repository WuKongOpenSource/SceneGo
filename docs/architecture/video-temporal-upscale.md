# Video enhancement media contract

The shared `utils/video_upscale_clock.py` utility validates a constant-frame-rate enhancement without changing the original files. It independently checks decoded frame timestamps, frame count, source and output frame rates, average frame rates, video-stream duration, and container duration. An audio track that outlasts the picture must not extend the final video frame.

Original audio streams are copied without re-encoding. Codec, sample rate, channel count, start offset, duration, and encoded packet hashes are verified. Failed verification does not authorize replacing the source. Variable-frame-rate videos and nonzero picture start times need an explicit frame map and are rejected by this version, not silently resampled.

The optional `video_temporal_frames` API field admits 5 or 9; it represents a processing window, not output fps. It does not alter image enhancement settings or enable unsupported generation capabilities in the public edition. The public source contains no local enhancement workflows, model weights, GPU agents, or inference experiment scripts.

Tests use FFmpeg synthetic clips only to verify frame timing and original audio preservation. Those tests are not evidence of improved person detail, reduced ghosting or reduced flicker; those require a controlled comparison with real source material and separately produced results.
