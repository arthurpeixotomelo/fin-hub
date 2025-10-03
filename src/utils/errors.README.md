# Error Handling System

## Overview

The fin-hub application uses a structured error handling system with custom error classes for better error categorization, user feedback, and debugging.

## Error Classes

### `CriticalError`

Critical errors represent serious failures that prevent the operation from completing successfully. These errors require user attention and typically involve data validation failures, missing required data, or system failures.

**Usage:**
```typescript
throw new CriticalError(
  'Short error summary',
  'Detailed explanation of what went wrong',
  { contextKey: 'contextValue', row: 42, sheet: 'RESULTADO' }
)
```

**Properties:**
- `severity: 'critical'` - Error severity level
- `message: string` - Short, user-facing error summary
- `details?: string` - Detailed explanation for debugging
- `context?: Record<string, unknown>` - Additional contextual data

**Example:**
```typescript
// Schema validation error
throw new CriticalError(
  'Validation error in sheet "RESULTADO" on row 15: the value "InvalidSegment" in field "Segmentos" => value should be one of [Empresas I, Empresas II, Select, Prospera, ...].',
  'Field "Segmentos" has value "InvalidSegment" => should be one of [Empresas I, Empresas II, Empresas III, ...]',
  { 
    sheet: 'RESULTADO', 
    row: 15, 
    field: 'Segmentos',
    actualValue: 'InvalidSegment',
    expectedValue: 'one of [Empresas I, Empresas II, ...]'
  }
)

// Numeric type validation error
throw new CriticalError(
  'In sheet "CONTABIL" on row 42: the value "ABC" in column "Jan/25" => value should be type of number (numeric/decimal value).',
  'Column "Jan/25" contains non-numeric value "ABC" at row 42. Expected a numeric value for date columns.',
  { 
    sheet: 'CONTABIL', 
    row: 42, 
    column: 'Jan/25', 
    actualValue: 'ABC', 
    expectedType: 'number' 
  }
)
```

### `WarningError`

Warning errors represent non-critical issues that may require user attention but don't necessarily prevent operation completion. These are useful for data quality issues, deprecated features, or recoverable errors.

**Usage:**
```typescript
throw new WarningError(
  'Data quality issue detected',
  'Some cells contain zero values which may affect analysis',
  { affectedRows: [10, 15, 20], sheet: 'CONTABIL' }
)
```

**Properties:**
- `severity: 'warning'` - Error severity level  
- `message: string` - Short, user-facing warning summary
- `details?: string` - Detailed explanation
- `context?: Record<string, unknown>` - Additional contextual data

## Utility Functions

### `parseError(error: unknown): StructuredError`

Converts any error (custom error classes, Error instances, strings, or unknown types) into a structured error object.

**Usage:**
```typescript
try {
  // ... operation
} catch (err) {
  const structured = parseError(err)
  console.log(structured.severity) // 'critical' | 'warning'
  console.log(structured.message)
  console.log(structured.details)
  console.log(structured.context)
}
```

### `formatErrorForDisplay(error: StructuredError): string`

Formats a structured error for user-friendly display with message, details, and context.

**Usage:**
```typescript
const structured = parseError(error)
const displayText = formatErrorForDisplay(structured)
// Returns formatted string with message, details, and context
```

## Integration with Upload System

### Backend (upload.ts)

The upload route handlers use custom error classes to provide structured error information:

```typescript
// Validation errors
if (err instanceof z.ZodError) {
  throw new CriticalError(
    `Validation error in sheet "${sheetName}" on row ${rowNum}`,
    err.issues.map(e => `${e.path.join('.')} - ${e.message}`).join(', '),
    { sheet: sheetName, row: rowNum, issues: err.issues }
  )
}

// Missing sheets
throw new CriticalError(
  'Missing required sheets in Excel file',
  `The following sheets are required: ${missingSheets.join(', ')}`,
  { missingSheets, requiredSheets: REQUIRED_SHEETS }
)

// Invalid data types
throw new CriticalError(
  `Invalid non-numeric value in sheet "${sheetName}"`,
  `Row ${row}, column "${col}" contains: "${value}"`,
  { sheet, row, column, value }
)

// Balance validation
throw new CriticalError(
  `Balance validation failed for column "${dateCol}"`,
  `RESULTADO must equal (CONTABIL + FICTICIO) for each Cod and Segmentos combination.\n\nFound ${count} imbalance(s)`,
  {
    dateColumn: dateCol,
    totalImbalances: count,
    firstImbalance: { cod, segmentos, resultado, contabil, ficticio, difference },
    allImbalances: imbalances
  }
)
```

### Progress Tracking

Error severity is tracked in the progress store and returned via the progress API:

```typescript
{
  progress: number,
  status: 'idle' | 'processing' | 'done' | 'error',
  error?: string,
  errorSeverity?: 'critical' | 'warning'
}
```

### Frontend (UploadFlow.tsx)

The ErrorModal component displays errors with visual severity indicators:

- **Critical errors**: Red color, 🚨 icon, "Upload Failed" title
- **Warning errors**: Orange color, ⚠️ icon, "Upload Warning" title

```typescript
<ErrorModal 
  errorMessage={uploadError} 
  severity={errorSeverity ?? 'critical'} 
/>
```

## State Management (upload.ts store)

The upload Zustand store tracks error severity:

```typescript
interface UploadState {
  error: string | null
  errorSeverity: ErrorSeverity | null
  // ... other state
}
```

Error severity is preserved throughout the upload lifecycle:
- Initial upload errors
- Progress polling errors  
- Finalize endpoint errors

## Best Practices

### Balance Validation

The system enforces a critical business rule: for each combination of `Cod`, `Segmentos`, and date column, the following equation must hold true:

```
RESULTADO - (CONTABIL + FICTICIO) = 0
```

**Validation Process:**
1. Runs after Excel file processing, before data insertion into preview table
2. Validates all date columns independently
3. Groups data by `Cod` and `Segmentos`
4. Checks balance with 0.01 tolerance for floating-point precision
5. Reports up to 10 worst imbalances if validation fails

**Error Example:**
```
CriticalError: Sum of values for (Cod: 1001, Segmentos: "Empresas I", Date: "Jan/25") in sheet "RESULTADO" should sum zero with sum of the same values in "CONTABIL" and "FICTICIO" (difference: R$ 5.000,00).

Details:
RESULTADO must equal (CONTABIL + FICTICIO) for each Cod and Segmentos combination.

Found 3 imbalance(s):

  Cod: 1001, Segmentos: "Empresas I"
    RESULTADO: R$ 150.000,00
    CONTABIL: R$ 100.000,00
    FICTICIO: R$ 45.000,00
    Difference: R$ 5.000,00

  Cod: 1002, Segmentos: "Select"
    RESULTADO: R$ 75.000,00
    CONTABIL: R$ 50.000,00
    FICTICIO: R$ 20.000,00
    Difference: R$ 5.000,00

  Cod: 1003, Segmentos: "Prospera"
    RESULTADO: R$ 30.000,00
    CONTABIL: R$ 25.000,00
    FICTICIO: R$ 4.000,00
    Difference: R$ 1.000,00

Context: {
  dateColumn: "Jan/25",
  totalImbalances: 3,
  firstImbalance: { cod: 1001, segmentos: "Empresas I", ... },
  allImbalances: [...]
}
```

**How to Fix:**
1. Check the Excel file for the specific Cod and Segmentos combinations listed
2. Verify values in RESULTADO, CONTABIL, and FICTICIO sheets for those rows
3. Ensure RESULTADO = CONTABIL + FICTICIO for each date column
4. Correct the values in Excel and re-upload

### When to use CriticalError
- Data validation failures (Zod schema errors)
- Missing required data (sheets, columns, rows)
- Type conversion errors (non-numeric values in numeric fields)
- **Balance validation failures (RESULTADO ≠ CONTABIL + FICTICIO)**
- File format errors
- Database/system failures

### When to use WarningError
- Data quality issues (unusual but valid values)
- Deprecated feature usage
- Recoverable errors with fallback behavior
- Performance concerns
- Best practice violations

### Error Message Guidelines
- **Message**: Short, user-facing summary (1-2 sentences)
- **Details**: Technical explanation with specific values, locations
- **Context**: Structured data for debugging (row numbers, field names, actual values)

### Example Pattern
```typescript
try {
  // Validate required field
  if (!value) {
    throw new CriticalError(
      'Required field missing',
      `Field "${fieldName}" is required in sheet "${sheet}"`,
      { sheet, row, field: fieldName }
    )
  }

  // Validate format
  if (!isValidFormat(value)) {
    throw new CriticalError(
      'Invalid field format',
      `Field "${fieldName}" must match pattern: ${pattern}`,
      { sheet, row, field: fieldName, value, expectedPattern: pattern }
    )
  }

  // Process...
} catch (err) {
  const structured = parseError(err)
  updateProgress(jobId, 0, 'error', structured.message, structured.severity)
  throw err
}
```

## Future Enhancements

Potential improvements to the error system:

1. **Error Recovery**: Allow warnings to continue processing
2. **Error Aggregation**: Collect multiple errors before failing
3. **Internationalization**: Multi-language error messages
4. **Error Codes**: Unique identifiers for programmatic handling
5. **Error Analytics**: Track error patterns for system improvements
6. **Retry Logic**: Automatic retry for transient failures
7. **User Actions**: Suggest specific fixes based on error type
