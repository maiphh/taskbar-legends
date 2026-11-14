export const CAMERA_SLEW_PX = 4;
export const CAMERA_MARGIN_PX = 48;

export type CombatCameraThreat = {
  deadline: number;
  focusX: number;
  xs: number[];
};

export type CombatCameraInput = {
  fieldWidth: number;
  laneWidth: number;
  partyXs: number[];
  threats: CombatCameraThreat[];
  formationXs?: number[];
};

function clampCamera(value: number, fieldWidth: number, laneWidth: number): number {
  return Math.max(0, Math.min(laneWidth - fieldWidth, value));
}

function idealCamera(input: CombatCameraInput): number {
  const party = input.partyXs;
  if (!party.length) return 0;
  const framed = [...party, ...(input.formationXs ?? [])];
  const pMin = Math.min(...framed);
  const pMax = Math.max(...framed);
  const target = (pMin + pMax - input.fieldWidth) / 2;
  const usable = Math.max(1, input.fieldWidth - CAMERA_MARGIN_PX);
  if (pMax - pMin <= usable) return clampCamera(target, input.fieldWidth, input.laneWidth);

  const coverLo = pMax - input.fieldWidth;
  const coverHi = pMin;
  if (coverLo <= coverHi) return clampCamera(Math.max(coverLo, Math.min(coverHi, target)), input.fieldWidth, input.laneWidth);
  return clampCamera((pMin + pMax) / 2 - input.fieldWidth / 2, input.fieldWidth, input.laneWidth);
}

export function stepCombatCamera(previous: number, input: CombatCameraInput): number {
  const target = Math.round(idealCamera(input));
  const delta = Math.max(-CAMERA_SLEW_PX, Math.min(CAMERA_SLEW_PX, target - previous));
  return previous + delta;
}
