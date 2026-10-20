# FloorPlanz

A rough proof of concept for a breaking set dictionary: name moves in Red Bull BC One rounds and in your own footage, connect them into sets, save combos, and see whether a computer can recognise them. It was vibe coded, so nothing really works properly yet. Part 1 of *Dreams in Draft* by Brian Toh.

Open `index.html` (or the GitHub Pages link). The **Start here** tab explains how to use it.

## Your data
Everything you name, and any video you add, stays in your own browser on your own device. Nothing is uploaded. Body tracking runs locally with MediaPipe.

## Credits and licences
- **BRACE** skeletons: Moltisanti, Wu, Dai & Loy, *BRACE: The Breakdancing Competition Dataset for Dance Motion Synthesis*, ECCV 2022 (NTU S-Lab, Singapore). S-Lab License 1.0, non-commercial use only.
- **Red Bull BC One** footage is embedded from Red Bull's YouTube channel and is not included in this repo.
- **CMU Graphics Lab Motion Capture Database**, mocap.cs.cmu.edu (subject 85, trial 90_28).
- **Move names:** FraGue Moser-Kindler's Breakdance Move List (frague.at), plus Wikipedia (CC BY-SA).
- **Body tracking:** Google MediaPipe Pose Landmarker (Apache 2.0).
- The demo clips in `clips/` are Brian's own sessions, shared with the permission of the people in them. Please don't reuse them.

Non-commercial. Not for training models or selling data.
