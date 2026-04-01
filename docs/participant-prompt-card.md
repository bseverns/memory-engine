# Participant Prompt Card

Use this when the recording station should stay visually quiet and the speaker
instructions need to live off-screen as a printed card, wall placard, or small
laminated stand.

## Front

### Room Memory

Leave a short voice or sound for the room.

1. Wake the microphone.
2. Check the meter if you want to make sure the room hears you.
3. Begin when you are ready.
4. Listen back if you want.
5. Choose what should happen next.

Please avoid names or identifying details.

## Back

### What happens next

#### Room Memory

- Saved on this device for about 48 hours
- The stored recording stays dry
- Played back in the room with gentle wear during playback
- Can be revoked later at `/revoke/` on this node with the receipt code

#### Fossil Only

- Raw sound kept only briefly on this device
- A spectrogram image and low-storage audio residue may remain locally for longer
- Can be revoked later at `/revoke/` on this node with the receipt code

#### Don't Save

- Played once immediately
- Then discarded from the device
- No revoke code is needed because it is not kept after playback

#### Memory color

- Memory color does not replace the stored recording
- It is saved separately and only changes how the memory leans when it returns in playback

## Steward explanation

If someone asks for the shortest truthful explanation, say:

- `Room Memory` stays on this device for about 48 hours and can be revoked later on this node with the receipt code
- `Fossil Only` lets the raw recording fade sooner while a local image or audio residue may remain longer
- `Don't Save` plays once and is then discarded from the device
- memory color changes playback character later, not the stored original recording

## Steward note

If you print this for the lab, place it next to the recording station rather
than on the playback surface. The point is to let the screen itself stay quiet
and delicate while the explanatory framing lives in the room.
