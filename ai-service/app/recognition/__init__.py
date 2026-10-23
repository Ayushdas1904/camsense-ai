"""Face recognition (Review 2).

Layout:
  face_model.py      load-once singletons for the YuNet detector and the SFace
                     embedder, each degrading gracefully when weights are absent
  face_service.py    the single clean interface used by HTTP routes and the
                     stream workers: detect_faces / generate_embedding /
                     match_embedding / register_face / recognize_frame
  embedding_cache.py thread-safe cache of the enrolled identities fetched from
                     the Node backend, kept as one stacked numpy matrix
  face_detection.py  a Detector implementation so face *presence* boxes flow
                     through the same pipeline and overlay path as human/weapon

Face DETECTION ("is a face present, and where?") and face RECOGNITION ("does
this face match an enrolled identity?") are deliberately separate concerns and
separate modules. Nothing here imports cv2 at module scope, so the pure
decision logic stays importable (and unit-testable) without the CV stack.
"""
