# Section Types Implementation - Frontend Documentation

## Overview

The section system has been extended to support multiple types of content sections. Previously, sections only supported plain text content. Now, sections can be of different types, with the first new type being **Match and Learn** - an interactive matching activity.

## What Changed

### Backend Changes

1. **Database Schema**: Extended the `Section` model to support:

   - A `type` field that determines the section type (default: `DEFAULT`)
   - Type-specific fields for Match and Learn sections
   - JSON storage for flexible data (items, config)

2. **API Updates**: Updated section creation and update endpoints to handle different section types

3. **Removed**: The standalone Match and Learn module has been removed and integrated into the Section system

### Section Types

#### 1. DEFAULT (Default Section)

The original section type with text-based content:

- Title
- Description
- Short Description
- Standard text content

#### 2. MATCH_AND_LEARN (Match and Learn Section)

Interactive matching activity where users match items to categories:

- Title
- Description
- Short Description
- Match and Learn specific configuration

---

## API Reference

### Base URL

All endpoints use the existing base URL structure.

### Section Types Enum

```typescript
enum SectionType {
  DEFAULT = 'DEFAULT',
  MATCH_AND_LEARN = 'MATCH_AND_LEARN',
}
```

---

## Creating Sections

### 1. Create Default Section

**Endpoint:** `POST /section`

**Request Body:**

```json
{
  "title": "Introduction to Safety",
  "description": "This section covers basic safety principles",
  "shortDescription": "Basic safety",
  "type": "DEFAULT", // Optional, defaults to "DEFAULT"
  "chapterId": "uuid-here",
  "moduleId": "uuid-here" // Optional
}
```

**Response:**

```json
{
  "message": "Successfully create section record",
  "statusCode": 200,
  "data": {
    "id": "section-uuid",
    "title": "Introduction to Safety",
    "description": "This section covers basic safety principles",
    "shortDescription": "Basic safety",
    "type": "DEFAULT",
    "chapterId": "uuid-here",
    "moduleId": "uuid-here",
    "createdAt": "2025-01-07T...",
    "updatedAt": "2025-01-07T...",
    // Match and Learn fields are null/empty for DEFAULT type
    "itemLabel": null,
    "categoryLabel": null,
    "categories": [],
    "maxPerCategory": 1,
    "orderIndex": "0",
    "isActive": true,
    "items": null,
    "config": null
  }
}
```

### 2. Create Match and Learn Section

**Endpoint:** `POST /section`

**Request Body:**

```json
{
  "title": "Match Safety Equipment",
  "description": "Match the equipment to its protection type",
  "shortDescription": "Equipment matching",
  "type": "MATCH_AND_LEARN",
  "chapterId": "uuid-here",
  "moduleId": "uuid-here", // Optional
  "itemLabel": "Equipment", // Label for left column
  "categoryLabel": "Protection Type", // Label for right column
  "items": [
    {
      "id": "item-1",
      "name": "Hard Hat",
      "correctCategory": "Head Protection"
    },
    {
      "id": "item-2",
      "name": "Safety Goggles",
      "correctCategory": "Eye Protection"
    },
    {
      "id": "item-3",
      "name": "Safety Boots",
      "correctCategory": "Foot Protection"
    }
  ],
  "categories": ["Head Protection", "Eye Protection", "Foot Protection"], // Optional - auto-generated from items if not provided
  "maxPerCategory": 1, // Optional, defaults to 1
  "orderIndex": "1", // Optional, defaults to "0"
  "isActive": true // Optional, defaults to true
}
```

**Response:**

```json
{
  "message": "Successfully create section record",
  "statusCode": 200,
  "data": {
    "id": "section-uuid",
    "title": "Match Safety Equipment",
    "description": "Match the equipment to its protection type",
    "shortDescription": "Equipment matching",
    "type": "MATCH_AND_LEARN",
    "chapterId": "uuid-here",
    "moduleId": "uuid-here",
    "itemLabel": "Equipment",
    "categoryLabel": "Protection Type",
    "categories": ["Head Protection", "Eye Protection", "Foot Protection"],
    "maxPerCategory": 1,
    "orderIndex": "1",
    "isActive": true,
    "items": [
      {
        "id": "item-1",
        "name": "Hard Hat",
        "correctCategory": "Head Protection"
      },
      {
        "id": "item-2",
        "name": "Safety Goggles",
        "correctCategory": "Eye Protection"
      },
      {
        "id": "item-3",
        "name": "Safety Boots",
        "correctCategory": "Foot Protection"
      }
    ],
    "config": null,
    "createdAt": "2025-01-07T...",
    "updatedAt": "2025-01-07T..."
  }
}
```

**Important Notes:**

- If `categories` array is not provided, it will be automatically generated from unique values in `items[].correctCategory`
- Each item must have a unique `id`
- The `correctCategory` values are case-sensitive

---

## Updating Sections

### Update Default Section

**Endpoint:** `PUT /section/update/:id`

**Request Body:**

```json
{
  "title": "Updated Title", // Optional
  "description": "Updated description", // Optional
  "shortDescription": "Updated short", // Optional
  "chapterId": "new-chapter-id", // Optional
  "moduleId": "new-module-id" // Optional
}
```

### Update Match and Learn Section

**Endpoint:** `PUT /section/update/:id`

**Request Body:**

```json
{
  "title": "Updated Title", // Optional
  "description": "Updated description", // Optional
  "itemLabel": "Updated Item Label", // Optional
  "categoryLabel": "Updated Category Label", // Optional
  "items": [
    {
      "id": "item-1",
      "name": "Updated Item Name",
      "correctCategory": "Updated Category"
    }
  ], // Optional - if updated, categories will be recalculated
  "categories": ["Category 1", "Category 2"], // Optional
  "maxPerCategory": 2, // Optional
  "orderIndex": "2", // Optional
  "isActive": false // Optional
}
```

**Notes:**

- Only include fields you want to update
- If `items` is updated and `categories` is not provided, categories will be automatically recalculated
- Partial updates are supported

---

## Retrieving Sections

### Get All Sections for a Chapter

**Endpoint:** `GET /sections/:chapterId` (or existing endpoint)

**Response:**

```json
{
  "message": "Successfully fetch all Sections info against chapter",
  "statusCode": 200,
  "data": [
    {
      "id": "section-1-uuid",
      "title": "Introduction",
      "type": "DEFAULT",
      // ... other DEFAULT section fields
    },
    {
      "id": "section-2-uuid",
      "title": "Match Safety Equipment",
      "type": "MATCH_AND_LEARN",
      "itemLabel": "Equipment",
      "categoryLabel": "Protection Type",
      "items": [...],
      // ... other MATCH_AND_LEARN section fields
    }
  ],
  "chapter": { ... }
}
```

---

## Frontend Implementation Guide

### 1. Section Type Detection

Always check the `type` field to determine how to render a section:

```typescript
interface Section {
  id: string;
  title: string;
  description: string;
  shortDescription?: string;
  type: 'DEFAULT' | 'MATCH_AND_LEARN';
  chapterId: string;
  moduleId?: string;

  // Match and Learn specific fields (null for DEFAULT type)
  itemLabel?: string;
  categoryLabel?: string;
  categories?: string[];
  maxPerCategory?: number;
  orderIndex?: string;
  isActive?: boolean;
  items?: Array<{
    id: string;
    name: string;
    correctCategory: string;
  }>;
  config?: any;

  createdAt: string;
  updatedAt: string;
}

// In your component
const renderSection = (section: Section) => {
  switch (section.type) {
    case 'DEFAULT':
      return <DefaultSectionView section={section} />;
    case 'MATCH_AND_LEARN':
      return <MatchAndLearnView section={section} />;
    default:
      return <DefaultSectionView section={section} />;
  }
};
```

### 2. Creating Sections

#### Default Section Form

```typescript
const createDefaultSection = async (data: {
  title: string;
  description: string;
  shortDescription?: string;
  chapterId: string;
  moduleId?: string;
}) => {
  const response = await fetch('/api/section', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...data,
      type: 'DEFAULT',
    }),
  });
  return response.json();
};
```

#### Match and Learn Section Form

```typescript
interface MatchAndLearnItem {
  id: string;
  name: string;
  correctCategory: string;
}

const createMatchAndLearnSection = async (data: {
  title: string;
  description: string;
  shortDescription?: string;
  chapterId: string;
  moduleId?: string;
  itemLabel: string;
  categoryLabel: string;
  items: MatchAndLearnItem[];
  maxPerCategory?: number;
  orderIndex?: string;
}) => {
  const response = await fetch('/api/section', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...data,
      type: 'MATCH_AND_LEARN',
    }),
  });
  return response.json();
};
```

### 3. Rendering Match and Learn Section

```typescript
interface MatchAndLearnProps {
  section: Section; // Must have type === 'MATCH_AND_LEARN'
}

const MatchAndLearnView: React.FC<MatchAndLearnProps> = ({ section }) => {
  const [userMatches, setUserMatches] = useState<Record<string, string>>({});

  if (section.type !== 'MATCH_AND_LEARN' || !section.items) {
    return <div>Invalid section type</div>;
  }

  const handleItemMatch = (itemId: string, category: string) => {
    setUserMatches({
      ...userMatches,
      [itemId]: category
    });
  };

  const checkAnswers = () => {
    let correct = 0;
    section.items!.forEach(item => {
      if (userMatches[item.id] === item.correctCategory) {
        correct++;
      }
    });
    return {
      correct,
      total: section.items!.length,
      percentage: (correct / section.items!.length) * 100
    };
  };

  return (
    <div className="match-and-learn">
      <h2>{section.title}</h2>
      <p>{section.description}</p>

      <div className="match-container">
        <div className="items-column">
          <h3>{section.itemLabel}</h3>
          {section.items.map(item => (
            <div
              key={item.id}
              className="draggable-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('itemId', item.id);
              }}
            >
              {item.name}
            </div>
          ))}
        </div>

        <div className="categories-column">
          <h3>{section.categoryLabel}</h3>
          {section.categories?.map(category => (
            <div
              key={category}
              className="drop-zone"
              onDrop={(e) => {
                const itemId = e.dataTransfer.getData('itemId');
                handleItemMatch(itemId, category);
              }}
              onDragOver={(e) => e.preventDefault()}
            >
              {category}
              {Object.entries(userMatches)
                .filter(([_, cat]) => cat === category)
                .map(([itemId]) => {
                  const item = section.items!.find(i => i.id === itemId);
                  return item ? <div key={itemId}>{item.name}</div> : null;
                })}
            </div>
          ))}
        </div>
      </div>

      <button onClick={checkAnswers}>Check Answers</button>
    </div>
  );
};
```

### 4. Progress Tracking

**Important**: Match and Learn sections use the same progress tracking system as default sections. When a user completes a Match and Learn activity, mark the section as completed using the existing progress tracking endpoints.

```typescript
// Mark section as completed (works for all section types)
const markSectionComplete = async (sectionId: string, chapterId: string) => {
  // Use existing progress tracking endpoint
  // The backend handles all section types uniformly
};
```

---

## UI/UX Recommendations

### Section Type Selector

When creating a new section, provide a type selector:

```typescript
<select
  value={sectionType}
  onChange={(e) => setSectionType(e.target.value)}
>
  <option value="DEFAULT">Text Content</option>
  <option value="MATCH_AND_LEARN">Match and Learn Activity</option>
</select>
```

### Conditional Form Fields

Show/hide form fields based on selected section type:

```typescript
{sectionType === 'MATCH_AND_LEARN' && (
  <>
    <input
      placeholder="Item Label (e.g., Equipment)"
      value={itemLabel}
      onChange={(e) => setItemLabel(e.target.value)}
    />
    <input
      placeholder="Category Label (e.g., Protection Type)"
      value={categoryLabel}
      onChange={(e) => setCategoryLabel(e.target.value)}
    />
    {/* Items editor */}
  </>
)}
```

### Section List Display

In section lists, indicate the section type with an icon or badge:

```typescript
<div className="section-item">
  <span>{section.title}</span>
  {section.type === 'MATCH_AND_LEARN' && (
    <span className="badge">Interactive</span>
  )}
</div>
```

---

## Migration Guide for Existing Code

### If You Had Match and Learn Code Before

1. **Remove old Match and Learn API calls**: The standalone Match and Learn endpoints no longer exist
2. **Update section creation**: Use the new section creation endpoint with `type: "MATCH_AND_LEARN"`
3. **Update section retrieval**: Match and Learn data is now included in section objects
4. **Progress tracking**: Use the existing section progress tracking (no changes needed)

### Example Migration

**Before:**

```typescript
// Old way (no longer works)
const matchAndLearn = await fetch('/api/match-and-learn');
```

**After:**

```typescript
// New way
const sections = await fetch('/api/sections/:chapterId');
const matchAndLearnSections = sections.filter(
  (s) => s.type === 'MATCH_AND_LEARN',
);
```

---

## Error Handling

The API will return standard error responses:

```json
{
  "status": 403,
  "error": "Validation error message"
}
```

**Common Errors:**

- `Missing required fields`: Ensure all required fields are provided for the section type
- `Invalid section type`: Use only `DEFAULT` or `MATCH_AND_LEARN`
- `Invalid items format`: For Match and Learn, items must have `id`, `name`, and `correctCategory`

---

## Testing Checklist

- [ ] Create a default section
- [ ] Create a Match and Learn section
- [ ] Update a default section
- [ ] Update a Match and Learn section
- [ ] Retrieve sections and verify type-specific fields
- [ ] Render default sections correctly
- [ ] Render Match and Learn sections correctly
- [ ] Handle section completion for both types
- [ ] Verify backward compatibility with existing sections

---

## Support

For questions or issues:

1. Check the API response for error messages
2. Verify section type is correctly set
3. Ensure all required fields are provided for the selected type
4. Check that Match and Learn sections have valid items array

---

## Future Section Types

The system is designed to easily add new section types in the future. When new types are added:

- The `SectionType` enum will be extended
- New type-specific fields may be added
- Documentation will be updated accordingly

The frontend should handle unknown section types gracefully by defaulting to the DEFAULT view or showing an appropriate message.
