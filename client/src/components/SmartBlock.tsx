import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';

interface BaseBlock {
  id: string;
  type: string;
  order: number;
  meta?: Record<string, any>;
}

interface HeaderBlock extends BaseBlock {
  type: 'header';
  text: string;
  level?: 1 | 2 | 3;
}

interface ParagraphBlock extends BaseBlock {
  type: 'paragraph';
  text: string;
}

interface ListBlock extends BaseBlock {
  type: 'list';
  items: string[];
  style?: 'bullet' | 'number';
}

interface ImageBlock extends BaseBlock {
  type: 'image';
  url: string;
  caption?: string;
}

interface QuoteBlock extends BaseBlock {
  type: 'quote';
  text: string;
  author: string;
}

interface CTABlock extends BaseBlock {
  type: 'cta';
  label: string;
  action: string;
  variant?: 'primary' | 'secondary';
}

interface DividerBlock extends BaseBlock {
  type: 'divider';
}

type Block = HeaderBlock | ParagraphBlock | ListBlock | ImageBlock | QuoteBlock | CTABlock | DividerBlock;

interface SmartBlockProps {
  block: Block;
}

export function SmartBlock({ block }: SmartBlockProps) {
  switch (block.type) {
    case 'header': {
      const HeaderTag = `h${block.level || 2}` as keyof JSX.IntrinsicElements;
      const sizeClass = block.level === 1 
        ? 'text-2xl font-bold' 
        : block.level === 3 
        ? 'text-lg font-semibold' 
        : 'text-xl font-bold';
      
      return (
        <HeaderTag 
          className={`${sizeClass} text-gray-900 dark:text-gray-100 mb-3`}
          data-testid={`block-header-${block.id}`}
        >
          {block.text}
        </HeaderTag>
      );
    }

    case 'paragraph':
      return (
        <p 
          className="text-gray-700 dark:text-gray-300 leading-relaxed mb-3"
          data-testid={`block-paragraph-${block.id}`}
        >
          {block.text}
        </p>
      );

    case 'list': {
      const ListTag = block.style === 'number' ? 'ol' : 'ul';
      const listClass = block.style === 'number' 
        ? 'list-decimal list-inside space-y-2 mb-3' 
        : 'list-disc list-inside space-y-2 mb-3';
      
      return (
        <ListTag 
          className={listClass}
          data-testid={`block-list-${block.id}`}
        >
          {block.items.map((item, idx) => (
            <li 
              key={idx}
              className="text-gray-700 dark:text-gray-300"
              data-testid={`block-list-item-${idx}`}
            >
              {item}
            </li>
          ))}
        </ListTag>
      );
    }

    case 'image':
      return (
        <figure className="mb-4" data-testid={`block-image-${block.id}`}>
          <img 
            src={block.url} 
            alt={block.caption || 'Image'} 
            className="w-full rounded-lg shadow-md"
          />
          {block.caption && (
            <figcaption className="text-sm text-gray-500 dark:text-gray-400 mt-2 text-center">
              {block.caption}
            </figcaption>
          )}
        </figure>
      );

    case 'quote':
      return (
        <Card 
          className="border-l-4 border-purple-500 bg-purple-50 dark:bg-purple-900/20 mb-4"
          data-testid={`block-quote-${block.id}`}
        >
          <CardContent className="p-4">
            <blockquote className="text-gray-800 dark:text-gray-200 italic mb-2">
              "{block.text}"
            </blockquote>
            <cite className="text-sm text-gray-600 dark:text-gray-400 not-italic">
              — {block.author}
            </cite>
          </CardContent>
        </Card>
      );

    case 'cta': {
      const isExternal = block.action.startsWith('http');
      const isPrimary = block.variant === 'primary' || !block.variant;
      
      return (
        <div className="mb-4" data-testid={`block-cta-${block.id}`}>
          {isExternal ? (
            <Button
              asChild
              variant={isPrimary ? 'default' : 'outline'}
              className="w-full"
            >
              <a href={block.action} target="_blank" rel="noopener noreferrer">
                {block.label}
              </a>
            </Button>
          ) : (
            <Button
              asChild
              variant={isPrimary ? 'default' : 'outline'}
              className="w-full"
            >
              <Link to={block.action}>{block.label}</Link>
            </Button>
          )}
        </div>
      );
    }

    case 'divider':
      return (
        <hr 
          className="border-t border-gray-300 dark:border-gray-700 my-6"
          data-testid={`block-divider-${block.id}`}
        />
      );

    default:
      // Unknown block type - render as JSON for debugging
      return (
        <Card className="bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 mb-4">
          <CardContent className="p-4">
            <p className="text-sm text-yellow-800 dark:text-yellow-200 font-semibold mb-2">
              Unknown block type: {(block as any).type}
            </p>
            <pre className="text-xs bg-white dark:bg-gray-800 p-2 rounded overflow-auto">
              {JSON.stringify(block, null, 2)}
            </pre>
          </CardContent>
        </Card>
      );
  }
}
