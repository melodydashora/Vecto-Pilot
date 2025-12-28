/**
 * usePlatformData - Hook for fetching rideshare platform market data
 *
 * Provides access to:
 * - Market list with city counts
 * - Market stats (total cities, countries, etc.)
 * - City search functionality
 * - Platform-specific data (default: uber)
 */

import { useQuery } from '@tanstack/react-query';

// API response types
export interface MarketListItem {
  market: string;
  country: string;
  city_count: number;
  timezone: string | null;
}

export interface MarketsResponse {
  platform: string;
  total_markets: number;
  markets: MarketListItem[];
}

export interface CityData {
  city: string;
  region: string | null;
  country: string;
  country_code: string | null;
  market: string | null;
  timezone: string | null;
  center_lat: number | null;
  center_lng: number | null;
  is_active?: boolean;
}

export interface MarketCitiesResponse {
  market: string;
  platform: string;
  city_count: number;
  timezone: string | null;
  cities: CityData[];
}

export interface SearchResponse {
  query: string;
  platform: string;
  result_count: number;
  cities: CityData[];
}

export interface CountryData {
  country: string;
  country_code: string | null;
  city_count: number;
  market_count: number;
  cities_with_timezone: number;
}

export interface CountriesResponse {
  platform: string;
  total_countries: number;
  countries: CountryData[];
}

export interface PlatformStats {
  total_cities: number;
  total_countries: number;
  total_markets: number;
  cities_with_timezone: number;
  cities_with_market: number;
  cities_with_boundary: number;
}

export interface StatsResponse {
  platform: string;
  stats: PlatformStats;
  top_countries: { country: string; city_count: number }[];
  top_markets: { market: string; city_count: number }[];
}

// Fetch functions
async function fetchMarkets(platform: string = 'uber'): Promise<MarketsResponse> {
  const response = await fetch(`/api/platform/markets?platform=${platform}`);
  if (!response.ok) throw new Error('Failed to fetch markets');
  return response.json();
}

async function fetchMarketCities(market: string, platform: string = 'uber'): Promise<MarketCitiesResponse> {
  const response = await fetch(`/api/platform/markets/${encodeURIComponent(market)}?platform=${platform}`);
  if (!response.ok) throw new Error('Failed to fetch market cities');
  return response.json();
}

async function fetchCountries(platform: string = 'uber'): Promise<CountriesResponse> {
  const response = await fetch(`/api/platform/countries?platform=${platform}`);
  if (!response.ok) throw new Error('Failed to fetch countries');
  return response.json();
}

async function fetchStats(platform: string = 'uber'): Promise<StatsResponse> {
  const response = await fetch(`/api/platform/stats?platform=${platform}`);
  if (!response.ok) throw new Error('Failed to fetch stats');
  return response.json();
}

async function searchCities(query: string, platform: string = 'uber', limit: number = 20): Promise<SearchResponse> {
  const response = await fetch(`/api/platform/search?q=${encodeURIComponent(query)}&platform=${platform}&limit=${limit}`);
  if (!response.ok) throw new Error('Failed to search cities');
  return response.json();
}

// Hooks
export function useMarkets(platform: string = 'uber') {
  return useQuery({
    queryKey: ['platform-markets', platform],
    queryFn: () => fetchMarkets(platform),
    staleTime: 1000 * 60 * 30, // 30 minutes - market data doesn't change often
  });
}

export function useMarketCities(market: string | null, platform: string = 'uber') {
  return useQuery({
    queryKey: ['platform-market-cities', market, platform],
    queryFn: () => fetchMarketCities(market!, platform),
    enabled: !!market,
    staleTime: 1000 * 60 * 30,
  });
}

export function useCountries(platform: string = 'uber') {
  return useQuery({
    queryKey: ['platform-countries', platform],
    queryFn: () => fetchCountries(platform),
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}

export function usePlatformStats(platform: string = 'uber') {
  return useQuery({
    queryKey: ['platform-stats', platform],
    queryFn: () => fetchStats(platform),
    staleTime: 1000 * 60 * 30,
  });
}

export function useCitySearch(query: string, platform: string = 'uber', limit: number = 20) {
  return useQuery({
    queryKey: ['platform-search', query, platform, limit],
    queryFn: () => searchCities(query, platform, limit),
    enabled: query.length >= 2,
    staleTime: 1000 * 60 * 5, // 5 minutes for search results
  });
}

// Default export with all hooks bundled
export default {
  useMarkets,
  useMarketCities,
  useCountries,
  usePlatformStats,
  useCitySearch,
};
