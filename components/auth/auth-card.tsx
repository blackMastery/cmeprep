import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card className="shadow-sm [--card-spacing:--spacing(6)]">
      <CardHeader className="space-y-1.5 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {children}
        {footer && (
          <div className="border-t border-border pt-4 text-center text-sm text-muted-foreground">
            {footer}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
