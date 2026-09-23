/**
 * A monitor's status word, as a pill with a dot. US-353.
 *
 * `status(monitor)` and `monitoringState(monitors)` both answer in this shape,
 * so a screen spreads either: `<MonitorStatus {...status(monitor)} />`. A
 * running monitor's dot blinks; one that found nothing is `attention`, quiet.
 */
export interface MonitorStatusProps {
  readonly label: string;
  /** "running", "paused" or "stopped". */
  readonly tone: string;
  readonly attention?: boolean;
}

export function MonitorStatus({ label, tone, attention }: MonitorStatusProps) {
  return <span className={`monitor-status ${tone}${attention ? " quiet" : ""}`}>{label}</span>;
}
