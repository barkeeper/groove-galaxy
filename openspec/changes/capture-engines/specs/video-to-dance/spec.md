## MODIFIED Requirements

### Requirement: Retarget landmarks to a VRMA clip
The pipeline SHALL convert the landmark JSON into VRM humanoid local bone rotations and write a
`assets/vrma/<id>.vrma` using the project's VRMA writer. It SHALL offer two selectable engines and
pin each limb bone's roll so hands and feet do not pass through the body. Output rotations SHALL be
temporally smoothed and the feet kept grounded (levelled flat via forward kinematics).

#### Scenario: Builtin bend-plane engine
- **WHEN** the retarget runs with the builtin engine
- **THEN** each limb bone's rotation is built from an orthonormal basis whose hinge axis is the joint
  bend normal (`upperDir × lowerDir`), and `assets/vrma/<id>.vrma` loads and animates without the
  hands twisting through the torso

#### Scenario: Kalidokit engine
- **WHEN** the retarget runs with `--engine kalido`
- **THEN** the Kalidokit Pose solver produces the hips/spine/arm/leg/wrist rotations and a valid
  `assets/vrma/<id>.vrma` is written

#### Scenario: Reuse one capture for two engines
- **WHEN** a dance is built with `--reuse <id>`
- **THEN** the existing capture's landmarks and audio are reused (no re-download/pose) and only the
  retarget + wiring run, so two engine variants can be produced from a single capture
