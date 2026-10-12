export interface NavigationDestination {
  lat?: number;
  lng?: number;
  placeId?: string;
  name?: string;
  address?: string;
}
export function googleDirectionsUrl(options?: NavigationDestination): string | null;
export function navigationLinkKind(url: string): 'directions' | 'map' | 'website';
