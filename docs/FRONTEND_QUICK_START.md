# Quick Start Guide - Section Types for Frontend Team

## TL;DR - What Changed?

1. **Sections now support multiple types**: `DEFAULT` (text) and `MATCH_AND_LEARN` (interactive matching)
2. **One unified API**: All sections (including Match and Learn) use the same `/section` endpoints
3. **Type field**: Every section now has a `type` field to determine how to render it

## Quick Reference

### Creating a Section

**Default Section:**

```typescript
POST /section
{
  "title": "My Section",
  "description": "Content here",
  "type": "DEFAULT",  // or omit it
  "chapterId": "uuid"
}
```

**Match and Learn Section:**

```typescript
POST /section
{
  "title": "Match Activity",
  "description": "Match items",
  "type": "MATCH_AND_LEARN",
  "chapterId": "uuid",
  "itemLabel": "Equipment",
  "categoryLabel": "Type",
  "items": [
    { "id": "1", "name": "Hard Hat", "correctCategory": "Head" }
  ]
}
```

### Rendering Logic

```typescript
if (section.type === 'MATCH_AND_LEARN') {
  // Render interactive matching UI
  // Use section.items, section.categories, etc.
} else {
  // Render default text content
  // Use section.title, section.description
}
```

## Key Points

✅ **Backward Compatible**: Existing sections automatically have `type: "DEFAULT"`  
✅ **Same Progress Tracking**: All section types use the same completion system  
✅ **Unified Endpoints**: Create/update/retrieve all use the same `/section` endpoints  
✅ **Type-Specific Fields**: Match and Learn sections include additional fields like `items`, `categories`, etc.

## Full Documentation

See [SECTION_TYPES_IMPLEMENTATION.md](./SECTION_TYPES_IMPLEMENTATION.md) for complete API reference and implementation details.
