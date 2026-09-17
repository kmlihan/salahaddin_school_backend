/**
 * Helpers for parent → student scoping. The Student model keeps both a
 * new `parents[]` array (multi-parent with relationship) and a legacy
 * single `parent` field (auto-synced to parents[0] on save). All
 * "fetch my child(ren)" queries should go through these so we stay
 * consistent during the migration window.
 */

/** Filter for Student.find / aggregate $match — all kids of this parent. */
function childrenScope(parentId) {
  return {
    $or: [
      { 'parents.parent': parentId },
      { parent: parentId },
    ],
  };
}

/** Filter for Student.findOne — this specific child, only if it's mine. */
function childScope(studentId, parentId) {
  return {
    _id: studentId,
    $or: [
      { 'parents.parent': parentId },
      { parent: parentId },
    ],
  };
}

module.exports = { childrenScope, childScope };
