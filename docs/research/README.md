# Research Documentation

This folder contains research findings that inform Vecto Pilot's architecture and future development.

## Document Index

| Document | Purpose | Key Topics |
|----------|---------|------------|
| [rideshare-algorithm-research.md](rideshare-algorithm-research.md) | Platform algorithm behaviors and subscription service architecture | iOS/Android solutions, detection rules, surge tracking |
| [mobile-subscription-architecture.md](mobile-subscription-architecture.md) | Mobile app architecture for subscription services | iOS Shortcuts, Android integration, platform separation |

## Research Categories

### Platform Algorithms
Research into how rideshare platforms (Uber/Lyft) calculate and present information to drivers, including:
- Acceptance rate thresholds and visibility impacts
- Surge pricing recalculation intervals
- Hidden trip information (multiple stops, long trips)
- Market-specific rate variations

### Mobile Integration
Research into mobile platform requirements for subscription-based services:
- iOS Shortcut workflows (no App Store required)
- Android automation integration
- Screenshot/OCR processing pipelines
- Real-time decision notification systems

## How This Research Informs Development

| Research Finding | Implementation Impact |
|------------------|----------------------|
| 85% acceptance threshold is critical | P0: Track acceptance rate with threshold alerts |
| Surge recalculates every 3-5 minutes | P1: Surge stability scoring system |
| Multiple stops detection has specific patterns | P0: Enhanced ping analysis rules |
| Market rates vary dramatically | P1: Market-specific rate cards in DB |

## Related Documentation

- [Architecture Decisions](../architecture/decisions.md) - How research informs architectural choices
- [Strategy Framework](../architecture/strategy-framework.md) - How recommendations are generated
- [AI Pipeline](../architecture/ai-pipeline.md) - Multi-model processing pipeline
