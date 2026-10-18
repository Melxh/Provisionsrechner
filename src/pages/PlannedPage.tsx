import { Alert, Card } from '../components/ui';

/** Ehrlicher Hinweis für Bereiche, die erst im nächsten Entwicklungsschritt gebaut werden – keine Attrappe. */
export default function PlannedPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-navy-800">{title}</h1>
      <Card>
        <Alert kind="info" title="Noch nicht umgesetzt">{description}</Alert>
      </Card>
    </div>
  );
}
