const { onDocumentDeleted } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();

/**
 * Keeps slot availability tied to actual registrations.
 *
 * When an organizer deletes a registration from Firestore, this trigger
 * decrements the matching non-PII slot counter so that the public form shows
 * the reopened appointment spot and allows another student to register.
 */
exports.releaseSlotOnRegistrationDelete = onDocumentDeleted("registrations/{registrationId}", async (event) => {
  const deletedRegistration = event.data?.data();
  if (!deletedRegistration) return;

  const { bloodDriveId, appointmentSlotId } = deletedRegistration;
  if (typeof bloodDriveId !== "string" || typeof appointmentSlotId !== "string") {
    logger.warn("Deleted registration missing slot metadata", { registrationId: event.params.registrationId });
    return;
  }

  const slotRef = admin.firestore().doc(`slotCounts/${bloodDriveId}_${appointmentSlotId}`);

  await admin.firestore().runTransaction(async (tx) => {
    const slotSnap = await tx.get(slotRef);
    if (!slotSnap.exists) {
      logger.warn("Slot counter missing while releasing deleted registration", {
        registrationId: event.params.registrationId,
        bloodDriveId,
        appointmentSlotId,
      });
      return;
    }

    const currentCount = slotSnap.get("count");
    if (typeof currentCount !== "number") {
      logger.warn("Slot counter count is not numeric while releasing deleted registration", {
        registrationId: event.params.registrationId,
        bloodDriveId,
        appointmentSlotId,
      });
      return;
    }

    tx.update(slotRef, { count: Math.max(0, currentCount - 1) });
  });
});
