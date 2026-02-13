import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Newspaper, Loader, ExternalLink, ChevronUp, ChevronDown } from "lucide-react";

interface NewsItem {
  title?: string;
  source?: string;
  url?: string;
  link?: string;
  snippet?: string;
  summary?: string;
  impact?: 'high' | 'medium' | 'low';
  published_date?: string;
}

interface NewsData {
  news?: {
    items?: NewsItem[];
    filtered?: NewsItem[];
    reason?: string;
  };
}

interface NewsCardProps {
  newsData?: NewsData;
  isNewsLoading: boolean;
}

export function NewsCard({ newsData, isNewsLoading }: NewsCardProps) {
  const [expandedNews, setExpandedNews] = useState(true);

  const news = newsData?.news;
  const newsItems = (news?.filtered || news?.items || []);
  const newsReason = news?.reason || null;

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'high': return 'bg-red-100 text-red-700 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
      default: return 'bg-green-100 text-green-700 border-green-300';
    }
  };

  return (
    <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
      <CardHeader
        className="pb-2 cursor-pointer hover:bg-purple-100/50 transition-colors"
        onClick={() => setExpandedNews(!expandedNews)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            {!news ? (
              <Loader className="w-5 h-5 animate-spin text-purple-600" />
            ) : (
              <>
                <Newspaper className="w-5 h-5 text-purple-600" />
                Rideshare News
                {newsItems.length > 0 && (
                  <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-300 ml-2">
                    {newsItems.length}
                  </Badge>
                )}
              </>
            )}
          </CardTitle>
          {expandedNews ? (
            <ChevronUp className="w-5 h-5 text-purple-600" />
          ) : (
            <ChevronDown className="w-5 h-5 text-purple-600" />
          )}
        </div>
      </CardHeader>
      {expandedNews && (
        <CardContent>
          {isNewsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader className="w-5 h-5 animate-spin text-purple-600 mr-2" />
              <span className="text-gray-600">Loading news...</span>
            </div>
          ) : newsItems.length > 0 ? (
            <div className="space-y-3">
              {newsItems.map((item, idx) => (
                <article 
                  key={idx} 
                  className="p-3 bg-white/50 rounded-lg border border-purple-100 hover:border-purple-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-800 text-sm">{item.title}</h4>
                      {item.published_date && (
                        <span className="text-xs text-gray-400">{item.published_date}</span>
                      )}
                    </div>
                    <Badge variant="outline" className={getImpactColor(item.impact || 'medium')}>
                      {item.impact}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">{item.summary}</p>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">{item.source}</span>
                    {item.link && (
                      <a 
                        href={item.link} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-purple-600 hover:text-purple-800 font-medium"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Link
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm text-center py-4">
              {newsReason || 'No rideshare news today'}
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
