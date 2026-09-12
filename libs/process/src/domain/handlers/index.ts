import { StepHandlerRegistry } from './registry.js';
import { CaptureBatchHandler } from './capture-batch.js';
import { CapturePhotoHandler } from './capture-photo.js';
import { CaptureQtyHandler } from './capture-qty.js';
import { CaptureReasonHandler } from './capture-reason.js';
import { ConfirmHandler } from './confirm.js';
import { ScanItemHandler } from './scan-item.js';
import { SelectNodeHandler } from './select-node.js';
import { SetDueDateHandler } from './set-due-date.js';

/** The eight of the MVP. Adding a ninth is a class and one line here. */
export function mvpRegistry(): StepHandlerRegistry {
  const registry = new StepHandlerRegistry();
  for (const handler of [
    new ScanItemHandler(),
    new CaptureBatchHandler(),
    new CaptureQtyHandler(),
    new CapturePhotoHandler(),
    new SelectNodeHandler(),
    new SetDueDateHandler(),
    new CaptureReasonHandler(),
    new ConfirmHandler(),
  ]) {
    registry.register(handler);
  }
  return registry;
}
