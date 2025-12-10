import { useStrategy, type BriefingItem } from '../../hooks/useStrategy';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Calendar, ExternalLink, MapPin, TrendingUp, Newspaper, AlertTriangle } from 'lucide-react';

export function SmartBlocks({ snapshotId }: { snapshotId?: string }) {
  const { data, loading, error } = useStrategy(snapshotId);
  const briefing = data?.strategy?.briefing;

  if (!snapshotId) {
    return (
      <Card data-testid="smart-blocks-no-snapshot">
        <CardContent className="p-4">
          <p className="text-sm text-gray-500">Missing snapshot.</p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card data-testid="smart-blocks-loading">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600"></div>
            <p className="text-sm text-gray-600">Loading smart blocks…</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card data-testid="smart-blocks-error">
        <CardContent className="p-4">
          <p className="text-sm text-red-600">Error loading blocks: {error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!briefing || data?.status === 'pending') {
    return (
      <Card data-testid="smart-blocks-pending">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            <p className="text-sm text-gray-600">
              AI is analyzing the market… ({data?.waitFor?.join(', ') || 'processing'})
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasAnyData = 
    (briefing.events && briefing.events.length > 0) ||
    (briefing.traffic && briefing.traffic.length > 0) ||
    (briefing.holidays && briefing.holidays.length > 0) ||
    (briefing.news && briefing.news.length > 0);

  if (!hasAnyData) {
    return (
      <Card data-testid="smart-blocks-empty">
        <CardContent className="p-4">
          <p className="text-sm text-gray-500">No market intelligence available yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="smart-blocks-container">
      <BlockSection
        title="Events"
        icon={<Calendar className="w-4 h-4" />}
        items={briefing.events}
        color="purple"
      />
      
      <BlockSection
        title="Traffic"
        icon={<TrendingUp className="w-4 h-4" />}
        items={briefing.traffic}
        color="orange"
      />
      
      <BlockSection
        title="Holidays"
        icon={<AlertTriangle className="w-4 h-4" />}
        items={briefing.holidays}
        color="green"
      />
      
      <BlockSection
        title="News"
        icon={<Newspaper className="w-4 h-4" />}
        items={briefing.news}
        color="blue"
      />
    </div>
  );
}

function BlockSection({
  title,
  icon,
  items,
  color
}: {
  title: string;
  icon: React.ReactNode;
  items?: BriefingItem[];
  color: string;
}) {
  if (!items || items.length === 0) return null;

  const colorClasses = {
    purple: 'bg-purple-50 border-purple-200 text-purple-900',
    orange: 'bg-orange-50 border-orange-200 text-orange-900',
    green: 'bg-green-50 border-green-200 text-green-900',
    blue: 'bg-blue-50 border-blue-200 text-blue-900'
  };

  const badgeColors = {
    purple: 'bg-purple-100 text-purple-700 border-purple-300',
    orange: 'bg-orange-100 text-orange-700 border-orange-300',
    green: 'bg-green-100 text-green-700 border-green-300',
    blue: 'bg-blue-100 text-blue-700 border-blue-300'
  };

  return (
    <Card className={colorClasses[color as keyof typeof colorClasses]} data-testid={`block-section-${title.toLowerCase()}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          {icon}
          <h3 className="font-semibold text-sm">{title}</h3>
          <Badge variant="outline" className={badgeColors[color as keyof typeof badgeColors]}>
            {items.length}
          </Badge>
        </div>
        <ul className="space-y-3">
          {items.map((item, i) => (
            <li key={i} data-testid={`block-item-${title.toLowerCase()}-${i}`}>
              <BlockItem item={item} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function BlockItem({ item }: { item: BriefingItem }) {
  const displayTitle = item.title || item.name || item.area || 'Unknown';
  
  return (
    <article className="text-sm space-y-1">
      <div className="flex items-start justify-between gap-2">
        <strong className="font-medium text-gray-900">{displayTitle}</strong>
        {item.severity && (
          <Badge variant="outline" className={
            item.severity === 'high' ? 'bg-red-50 text-red-700 border-red-300' :
            item.severity === 'medium' ? 'bg-yellow-50 text-yellow-700 border-yellow-300' :
            'bg-green-50 text-green-700 border-green-300'
          }>
            {item.severity}
          </Badge>
        )}
      </div>
      
      {item.summary && <p className="text-gray-600 text-xs">{item.summary}</p>}
      {item.note && <p className="text-gray-600 text-xs">{item.note}</p>}
      {item.impact && <p className="text-gray-600 text-xs italic">Impact: {item.impact}</p>}
      
      <div className="flex items-center gap-3 text-xs text-gray-500">
        {item.startTime && (
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {item.startTime}
          </span>
        )}
        {item.date && (
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {item.date}
          </span>
        )}
        {item.venue && (
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {item.venue}
          </span>
        )}
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-blue-600 hover:text-blue-800"
            data-testid="block-item-link"
          >
            <ExternalLink className="w-3 h-3" />
            Read more
          </a>
        )}
      </div>
    </article>
  );
}
