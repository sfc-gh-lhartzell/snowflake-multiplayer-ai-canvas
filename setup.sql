-- =============================================================================
-- Agent Canvas — Snowflake setup
-- =============================================================================
-- Run this once in your Snowflake account to create every object the app
-- needs. Run as ACCOUNTADMIN or a role with equivalent privileges.
--
-- Creates:
--   AGENT_CANVAS_PLUS_ROLE          Least-privilege execution role for the app
--   AGENT_CANVAS_PLUS_WH            XS warehouse for Analyst queries
--   AGENT_CANVAS_PLUS                Database with two schemas:
--     PUBLIC.CANVASES            Thread-ID mapping table (app plumbing)
--     AGENTS.TPCH_REV_SV         Semantic view over TPC-H sample data
--     AGENTS.CANVAS_AGENT        Cortex Agent with five tools
--   SNOWFLAKE_DOCUMENTATION    Installed from Marketplace listing GZSTZ67BY9OQ4
--   SNOWFLAKE_SAMPLE_DATA      Mounted from the sample data share if missing
--
-- After this runs:
--   snow app deploy
-- =============================================================================

USE ROLE ACCOUNTADMIN;

-- -----------------------------------------------------------------------------
-- 1. Role, warehouse, database, schemas
-- -----------------------------------------------------------------------------
CREATE ROLE IF NOT EXISTS AGENT_CANVAS_PLUS_ROLE
  COMMENT = 'Least-privilege execution role for the Agent Canvas app';

CREATE WAREHOUSE IF NOT EXISTS AGENT_CANVAS_PLUS_WH
  WAREHOUSE_SIZE = XSMALL
  AUTO_SUSPEND = 60
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE
  COMMENT = 'Warehouse for Agent Canvas Analyst queries';

CREATE DATABASE IF NOT EXISTS AGENT_CANVAS_PLUS
  COMMENT = 'Agent Canvas app database';
USE DATABASE AGENT_CANVAS_PLUS;

CREATE SCHEMA IF NOT EXISTS AGENTS
  COMMENT = 'Cortex Agent and semantic view';
CREATE SCHEMA IF NOT EXISTS PUBLIC
  COMMENT = 'App plumbing — canvas-to-thread mapping';

-- -----------------------------------------------------------------------------
-- 2. CANVASES table (maps a canvas ID to the Cortex Agent thread ID)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS AGENT_CANVAS_PLUS.PUBLIC.CANVASES (
  canvas_id     VARCHAR    NOT NULL,
  thread_id     NUMBER     NOT NULL,
  display_name  VARCHAR,
  created_by    VARCHAR    NOT NULL,
  created_at    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  CONSTRAINT pk_canvases PRIMARY KEY (canvas_id)
);

-- Durable, append-only log of context captured via /file in the canvas UI.
-- One row per filing event. See src/app/api/canvas/[id]/file/route.ts for the
-- write path and src/components/FilingCard.tsx for how filings render.
CREATE TABLE IF NOT EXISTS AGENT_CANVAS_PLUS.PUBLIC.CANVAS_CONTEXT (
  id            VARCHAR       NOT NULL,     -- filing uuid (one row per filing)
  canvas_id     VARCHAR       NOT NULL,     -- links to CANVASES.canvas_id
  thread_id     NUMBER,                     -- Cortex thread ID at filing time (nullable)
  filed_by      VARCHAR       NOT NULL,     -- user who ran /file
  participants  ARRAY,                      -- usernames present when filed
  source        VARCHAR       NOT NULL,     -- 'user' | 'agent'
  context       VARCHAR       NOT NULL,     -- the filed text
  filed_at      TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  CONSTRAINT pk_canvas_context PRIMARY KEY (id)
);

-- -----------------------------------------------------------------------------
-- 2b. Canvas Plus: docs, slides, artifacts, comments, approvals
-- -----------------------------------------------------------------------------
-- DOCS holds every document in a canvas. YDOC_STATE is the base64-encoded Yjs
-- state (the source of truth for collaborative editing); SNAPSHOT is a plain
-- markdown/HTML/JSON rendering the agent can read with READ_DOCUMENT.
CREATE TABLE IF NOT EXISTS AGENT_CANVAS_PLUS.PUBLIC.DOCS (
  doc_id        VARCHAR       NOT NULL,
  canvas_id     VARCHAR       NOT NULL,
  kind          VARCHAR       NOT NULL,     -- doc | slides | html | markdown | chart
  title         VARCHAR       NOT NULL,
  ydoc_state    VARCHAR,                    -- base64 Yjs update
  snapshot      VARCHAR,                    -- readable rendering for the agent
  seed          VARCHAR,                    -- initial content, applied once by the first editor
  created_by    VARCHAR       NOT NULL,
  updated_by    VARCHAR,
  created_at    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  updated_at    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  archived      BOOLEAN       DEFAULT FALSE,
  CONSTRAINT pk_docs PRIMARY KEY (doc_id)
);

-- Point-in-time copies written on autosave (throttled) for version history.
CREATE TABLE IF NOT EXISTS AGENT_CANVAS_PLUS.PUBLIC.DOC_VERSIONS (
  version_id    VARCHAR       NOT NULL,
  doc_id        VARCHAR       NOT NULL,
  ydoc_state    VARCHAR,
  snapshot      VARCHAR,
  saved_by      VARCHAR,
  saved_at      TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  CONSTRAINT pk_doc_versions PRIMARY KEY (version_id)
);

-- Threaded comments. The anchor lives in the document itself (a comment mark
-- carrying COMMENT_ID); QUOTE keeps the anchored text for display.
CREATE TABLE IF NOT EXISTS AGENT_CANVAS_PLUS.PUBLIC.COMMENTS (
  comment_id    VARCHAR       NOT NULL,
  doc_id        VARCHAR       NOT NULL,
  canvas_id     VARCHAR       NOT NULL,
  parent_id     VARCHAR,
  quote         VARCHAR,
  author        VARCHAR       NOT NULL,
  body          VARCHAR       NOT NULL,
  resolved      BOOLEAN       DEFAULT FALSE,
  created_at    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  updated_at    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  CONSTRAINT pk_comments PRIMARY KEY (comment_id)
);

-- SQL writes the agent proposes. Nothing here runs until a teammate approves
-- it in the canvas; the app then executes it and records the outcome.
CREATE TABLE IF NOT EXISTS AGENT_CANVAS_PLUS.PUBLIC.PENDING_ACTIONS (
  action_id     VARCHAR       NOT NULL,
  canvas_id     VARCHAR       NOT NULL,
  kind          VARCHAR       NOT NULL,     -- sql | code
  sql_text      VARCHAR,
  rationale     VARCHAR,
  proposed_by   VARCHAR       NOT NULL,     -- the teammate whose turn produced it
  status        VARCHAR       NOT NULL,     -- pending | approved | rejected | failed
  decided_by    VARCHAR,
  result        VARIANT,
  created_at    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
  decided_at    TIMESTAMP_NTZ,
  CONSTRAINT pk_pending_actions PRIMARY KEY (action_id)
);

-- Audit log of every document tool call the agent made.
CREATE TABLE IF NOT EXISTS AGENT_CANVAS_PLUS.PUBLIC.AI_OPS (
  op_id         VARCHAR       DEFAULT UUID_STRING(),
  canvas_id     VARCHAR,
  doc_id        VARCHAR,
  tool          VARCHAR       NOT NULL,
  input         VARIANT,
  created_at    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- A scratch schema the agent's approved SQL can write to.
CREATE SCHEMA IF NOT EXISTS AGENT_CANVAS_PLUS.SANDBOX
  COMMENT = 'Writable scratch space for agent-proposed, human-approved SQL';
CREATE TABLE IF NOT EXISTS AGENT_CANVAS_PLUS.SANDBOX.TEAM_TARGETS (
  region        VARCHAR,
  fiscal_year   NUMBER,
  revenue_target NUMBER(18,2),
  owner         VARCHAR,
  note          VARCHAR,
  updated_at    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- -----------------------------------------------------------------------------
-- 3. Install the Snowflake Documentation CKE
-- -----------------------------------------------------------------------------
-- Free Cortex Knowledge Extension published by Snowflake. If you already have
-- the SNOWFLAKE_DOCUMENTATION database installed, this block is a no-op.
-- Run as a human user (TYPE=PERSON); SERVICE users can't request listings.
-- Accepting the listing terms is required before CREATE DATABASE FROM LISTING
-- on accounts that have never installed it; re-running is a no-op.
-- -----------------------------------------------------------------------------
CALL SYSTEM$ACCEPT_LEGAL_TERMS('DATA_EXCHANGE_LISTING', 'GZSTZ67BY9OQ4');
CALL SYSTEM$REQUEST_LISTING_AND_WAIT('GZSTZ67BY9OQ4');
CREATE DATABASE IF NOT EXISTS SNOWFLAKE_DOCUMENTATION
  FROM LISTING 'GZSTZ67BY9OQ4';

-- -----------------------------------------------------------------------------
-- 4. Semantic view over TPC-H sample data
-- -----------------------------------------------------------------------------
-- SNOWFLAKE_SAMPLE_DATA.TPCH_SF1 is auto-provisioned in most Snowflake
-- accounts, but some (e.g. trial, lab, or org-created accounts) don't have it
-- mounted. Create it from the sample data share if missing; no-op otherwise.
-- This semantic view wraps CUSTOMER, ORDERS, LINEITEM, NATION, and
-- REGION with named dimensions and metrics so Cortex Analyst can route
-- natural-language questions into deterministic SQL.
-- -----------------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS SNOWFLAKE_SAMPLE_DATA
  FROM SHARE SFC_SAMPLES.SAMPLE_DATA;

CREATE OR REPLACE SEMANTIC VIEW AGENT_CANVAS_PLUS.AGENTS.TPCH_REV_SV

  TABLES (
    customers AS SNOWFLAKE_SAMPLE_DATA.TPCH_SF1.CUSTOMER
      PRIMARY KEY (c_custkey)
      WITH SYNONYMS ('customer', 'client', 'buyer')
      COMMENT = 'Customer master; one row per customer',
    orders AS SNOWFLAKE_SAMPLE_DATA.TPCH_SF1.ORDERS
      PRIMARY KEY (o_orderkey)
      WITH SYNONYMS ('sales order', 'purchase order')
      COMMENT = 'Order header; one row per order',
    line_items AS SNOWFLAKE_SAMPLE_DATA.TPCH_SF1.LINEITEM
      PRIMARY KEY (l_orderkey, l_linenumber)
      WITH SYNONYMS ('order line', 'order item')
      COMMENT = 'Order line items; one row per line in an order',
    nations AS SNOWFLAKE_SAMPLE_DATA.TPCH_SF1.NATION
      PRIMARY KEY (n_nationkey)
      COMMENT = 'Country reference',
    regions AS SNOWFLAKE_SAMPLE_DATA.TPCH_SF1.REGION
      PRIMARY KEY (r_regionkey)
      COMMENT = 'Geographic region reference'
  )

  RELATIONSHIPS (
    orders_to_customers AS
      orders (o_custkey) REFERENCES customers,
    line_items_to_orders AS
      line_items (l_orderkey) REFERENCES orders,
    customers_to_nations AS
      customers (c_nationkey) REFERENCES nations,
    nations_to_regions AS
      nations (n_regionkey) REFERENCES regions
  )

  FACTS (
    line_items.extended_price AS l_extendedprice
      COMMENT = 'Extended price (quantity * unit price) before discount',
    line_items.discounted_price AS l_extendedprice * (1 - l_discount)
      COMMENT = 'Price after discount but before tax',
    line_items.quantity AS l_quantity
      COMMENT = 'Units shipped on this line'
  )

  DIMENSIONS (
    nations.nation_name AS nations.n_name
      WITH SYNONYMS = ('country', 'country name')
      COMMENT = 'Name of the customer''s country',
    regions.region_name AS regions.r_name
      WITH SYNONYMS = ('continent', 'region')
      COMMENT = 'Geographic region (AFRICA, AMERICA, ASIA, EUROPE, MIDDLE EAST)',
    customers.market_segment AS customers.c_mktsegment
      WITH SYNONYMS = ('segment', 'market')
      COMMENT = 'Market segment (AUTOMOBILE, BUILDING, FURNITURE, HOUSEHOLD, MACHINERY)',
    orders.order_date AS orders.o_orderdate
      COMMENT = 'Date the order was placed',
    orders.order_year AS YEAR(orders.o_orderdate)
      COMMENT = 'Year the order was placed',
    orders.order_month AS DATE_TRUNC('month', orders.o_orderdate)
      COMMENT = 'Month the order was placed (truncated to month start)',
    orders.order_status AS orders.o_orderstatus
      COMMENT = 'Order status (F = fulfilled, O = open, P = partial)',
    line_items.ship_mode AS line_items.l_shipmode
      COMMENT = 'Shipping method (AIR, RAIL, SHIP, TRUCK, MAIL, FOB, REG AIR)'
  )

  METRICS (
    line_items.total_revenue AS SUM(line_items.discounted_price)
      COMMENT = 'Total discounted revenue across all line items',
    line_items.total_quantity AS SUM(line_items.quantity)
      COMMENT = 'Total units shipped',
    orders.order_count AS COUNT(DISTINCT orders.o_orderkey)
      COMMENT = 'Count of distinct orders',
    customers.customer_count AS COUNT(DISTINCT customers.c_custkey)
      COMMENT = 'Count of distinct customers',
    line_items.line_item_count AS COUNT(*)
      COMMENT = 'Count of line items',
    orders.avg_order_value AS AVG(orders.o_totalprice)
      COMMENT = 'Average total order price'
  )

  COMMENT = 'TPC-H revenue analysis — the stock semantic view that ships with the Agent Canvas demo. Swap in your own view to point the agent at your data.'

  AI_VERIFIED_QUERIES (
    revenue_by_region AS (
      QUESTION 'What is the total revenue by region?'
      SQL 'SELECT * FROM SEMANTIC_VIEW(AGENT_CANVAS_PLUS.AGENTS.TPCH_REV_SV METRICS line_items.total_revenue DIMENSIONS regions.region_name) ORDER BY total_revenue DESC'
    ),
    revenue_by_year AS (
      QUESTION 'What is total revenue per year?'
      SQL 'SELECT * FROM SEMANTIC_VIEW(AGENT_CANVAS_PLUS.AGENTS.TPCH_REV_SV METRICS line_items.total_revenue DIMENSIONS orders.order_year) ORDER BY order_year'
    ),
    top_segments_by_revenue AS (
      QUESTION 'Which market segment has the highest revenue?'
      SQL 'SELECT * FROM SEMANTIC_VIEW(AGENT_CANVAS_PLUS.AGENTS.TPCH_REV_SV METRICS line_items.total_revenue DIMENSIONS customers.market_segment) ORDER BY total_revenue DESC'
    )
  );

-- -----------------------------------------------------------------------------
-- 4b. GET_FILINGS UDF — the agent's read tool over CANVAS_CONTEXT
-- -----------------------------------------------------------------------------
-- Returns a JSON array of filing records for a given canvas, newest first.
-- Called by the agent via a `generic` tool when a user asks about saved
-- context, prior decisions, or the history of the room.
CREATE OR REPLACE FUNCTION AGENT_CANVAS_PLUS.AGENTS.GET_FILINGS(canvas_id STRING)
RETURNS ARRAY
AS
$$
  SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
    'id', id,
    'filed_by', filed_by,
    'source', source,
    'participants', participants,
    'context', context,
    'filed_at', filed_at
  )) WITHIN GROUP (ORDER BY filed_at DESC)
  FROM AGENT_CANVAS_PLUS.PUBLIC.CANVAS_CONTEXT c
  WHERE c.canvas_id = canvas_id
$$;

-- -----------------------------------------------------------------------------
-- 4c. Canvas Plus document + SQL tools
-- -----------------------------------------------------------------------------
-- Write tools are deliberately thin: each procedure records the call in AI_OPS
-- and returns an acknowledgement. The canvas app watches the agent's event
-- stream and applies the change itself (live, in every teammate's editor), so
-- documents stay one collaborative source of truth. PROPOSE_SQL never runs the
-- statement: it waits in the canvas for a teammate's approval.
CREATE OR REPLACE PROCEDURE AGENT_CANVAS_PLUS.AGENTS.CREATE_DOCUMENT(
  canvas_id STRING, kind STRING, title STRING, content STRING)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
BEGIN
  INSERT INTO AGENT_CANVAS_PLUS.PUBLIC.AI_OPS (canvas_id, tool, input)
    SELECT :canvas_id, 'create_document',
           OBJECT_CONSTRUCT('kind', :kind, 'title', :title, 'chars', LENGTH(:content));
  RETURN OBJECT_CONSTRUCT('status', 'created',
    'note', 'The document is open in the canvas for the whole team. Tell them its title; do not paste its full content into chat.');
END;
$$;

CREATE OR REPLACE PROCEDURE AGENT_CANVAS_PLUS.AGENTS.EDIT_DOCUMENT(
  canvas_id STRING, document STRING, operation STRING, find_text STRING, new_text STRING)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
BEGIN
  INSERT INTO AGENT_CANVAS_PLUS.PUBLIC.AI_OPS (canvas_id, doc_id, tool, input)
    SELECT :canvas_id, :document, 'edit_document',
           OBJECT_CONSTRUCT('operation', :operation, 'find', :find_text, 'chars', LENGTH(:new_text));
  RETURN OBJECT_CONSTRUCT('status', 'suggested',
    'note', 'The edit was added to the document as a tracked suggestion. Teammates accept or reject it.');
END;
$$;

CREATE OR REPLACE PROCEDURE AGENT_CANVAS_PLUS.AGENTS.COMMENT_ON_DOCUMENT(
  canvas_id STRING, document STRING, quote STRING, comment STRING)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
BEGIN
  INSERT INTO AGENT_CANVAS_PLUS.PUBLIC.AI_OPS (canvas_id, doc_id, tool, input)
    SELECT :canvas_id, :document, 'comment_on_document', OBJECT_CONSTRUCT('quote', :quote);
  RETURN OBJECT_CONSTRUCT('status', 'commented');
END;
$$;

CREATE OR REPLACE PROCEDURE AGENT_CANVAS_PLUS.AGENTS.PROPOSE_SQL(
  canvas_id STRING, sql_text STRING, rationale STRING)
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
BEGIN
  INSERT INTO AGENT_CANVAS_PLUS.PUBLIC.AI_OPS (canvas_id, tool, input)
    SELECT :canvas_id, 'propose_sql', OBJECT_CONSTRUCT('sql', :sql_text, 'rationale', :rationale);
  RETURN OBJECT_CONSTRUCT('status', 'awaiting_approval',
    'note', 'The statement has NOT run. It is waiting for a teammate to approve it in the canvas. Say so, and do not report results.');
END;
$$;

-- Read tools: the agent can see what the team wrote.
-- DESCRIBE_SANDBOX lists the writable tables and their columns, so proposed
-- SQL uses real column names.
CREATE OR REPLACE PROCEDURE AGENT_CANVAS_PLUS.AGENTS.DESCRIBE_SANDBOX()
RETURNS VARIANT
LANGUAGE SQL
EXECUTE AS OWNER
AS
$$
DECLARE
  result VARIANT;
BEGIN
  SELECT ARRAY_AGG(OBJECT_CONSTRUCT('table', 'AGENT_CANVAS_PLUS.SANDBOX.' || table_name,
                                    'column', column_name, 'type', data_type))
           WITHIN GROUP (ORDER BY table_name, ordinal_position)
    INTO :result
    FROM AGENT_CANVAS_PLUS.INFORMATION_SCHEMA.COLUMNS
   WHERE table_schema = 'SANDBOX';
  RETURN COALESCE(result, ARRAY_CONSTRUCT());
END;
$$;
CREATE OR REPLACE FUNCTION AGENT_CANVAS_PLUS.AGENTS.LIST_DOCUMENTS(canvas_id STRING)
RETURNS ARRAY
AS
$$
  SELECT ARRAY_AGG(OBJECT_CONSTRUCT(
    'doc_id', doc_id, 'kind', kind, 'title', title,
    'updated_by', updated_by, 'updated_at', updated_at
  )) WITHIN GROUP (ORDER BY updated_at DESC)
  FROM AGENT_CANVAS_PLUS.PUBLIC.DOCS d
  WHERE d.canvas_id = canvas_id AND NOT d.archived
$$;

CREATE OR REPLACE FUNCTION AGENT_CANVAS_PLUS.AGENTS.READ_DOCUMENT(canvas_id STRING, document STRING)
RETURNS OBJECT
AS
$$
  SELECT OBJECT_CONSTRUCT('doc_id', doc_id, 'kind', kind, 'title', title,
                          'content', COALESCE(snapshot, seed, ''))
  FROM AGENT_CANVAS_PLUS.PUBLIC.DOCS d
  WHERE d.canvas_id = canvas_id
    AND (d.doc_id = document OR LOWER(d.title) = LOWER(document))
  ORDER BY d.updated_at DESC
  LIMIT 1
$$;

-- -----------------------------------------------------------------------------
-- 5. Cortex Agent
-- -----------------------------------------------------------------------------
CREATE OR REPLACE AGENT AGENT_CANVAS_PLUS.AGENTS.CANVAS_AGENT
  COMMENT = 'Agent Canvas demo agent — routes TPC-H revenue questions to Analyst, Snowflake documentation questions to Search, visualizes with Data to Chart, and uses web search for context.'
  PROFILE = '{"display_name": "Luke", "color": "blue"}'
  FROM SPECIFICATION
  $$
  models:
    orchestration: auto

  orchestration:
    tool_not_accessible: accept
    budget:
      seconds: 180
      tokens: 64000

  instructions:
    response: "You are Luke, a teammate agent inside a shared canvas. Multiple humans are in the room with you and they co-edit documents, slide decks, and artifacts next to the chat. Answer concisely. When you create or edit a document, say what you made and its title in one or two sentences; never paste the full content into chat. When you propose SQL, say clearly that it has not run and is waiting for a teammate's approval. Do not offer to save things as personal skills, memory, or external storage; this canvas only has what the available tools provide."
    orchestration: "The first line of every user message is `[canvas: <id>]` — treat that id as the current canvas and pass it to any tool that needs a canvas identifier. For revenue, order, customer, nation, region, or market segment questions, use tpch_analyst. For Snowflake documentation, SQL syntax, feature behavior, or best practices, use docs_search. For questions about what has been filed in this room, prior decisions, saved context, or the history of this canvas, call get_filings with the current canvas id. Call data_to_chart after tpch_analyst when the result is numeric and would benefit from a visualization. Use web_search only as a last resort for topics not covered by the other tools. DOCUMENTS: The canvas holds documents of kind doc (rich text), slides (a deck; separate slides with a line containing only ---, each slide starts with a # heading), html (a self-contained HTML/CSS/JS artifact), markdown, and chart (a Vega-Lite JSON spec with inline data). When asked to write, draft, summarize into, or build something, call create_document with markdown content (for doc, slides, markdown), full HTML (for html), or Vega-Lite JSON (for chart). Before editing or commenting, call list_documents or read_document to see the current text. To change existing text, call edit_document with operation replace, append, or prepend; edits land as tracked suggestions the team can accept. For replace, find_text is the exact words of one passage from the document, without markdown symbols (no #, -, **, or ---), and should cover one paragraph, list, or slide; make several edit_document calls for several changes rather than one replace of the whole document. new_text is markdown. In a slides deck, change one slide per call, and add a new slide by appending markdown that starts with --- on its own line. To give feedback, call comment_on_document with an exact quote. If a message says [open document: <title>], that is the document the team is looking at. SQL WRITES: When the team asks to insert, update, merge, delete, or create objects, write one Snowflake SQL statement and call propose_sql with it and a one-line rationale. Before proposing a write to an existing table, call describe_sandbox and use its exact column names. Prefer the AGENT_CANVAS_PLUS.SANDBOX schema for new tables. Never call propose_sql for read-only questions; use tpch_analyst for those. CODE: Use code_execution for calculations, data reshaping, simulations, or to test Python code the team asks you to write. To hand the team code they can keep, also put it in a document."
    sample_questions:
      - question: "What is the total revenue by region?"
      - question: "How do I create a Snowpipe?"
      - question: "What context have we filed in this canvas?"
      - question: "Draft a one-page brief on revenue by region as a doc."
      - question: "Turn our brief into a 5-slide deck."
      - question: "Propose a table of 2027 revenue targets by region."

  tools:
    - tool_spec:
        type: "cortex_analyst_text_to_sql"
        name: "tpch_analyst"
        description: "Converts natural language questions about TPC-H revenue, orders, customers, nations, regions, and market segments into SQL via the TPCH_REV_SV semantic view."
    - tool_spec:
        type: "cortex_search"
        name: "docs_search"
        description: "Searches the official Snowflake documentation for SQL syntax, feature behavior, and best practices."
    - tool_spec:
        type: "data_to_chart"
        name: "data_to_chart"
        description: "Generates a Vega-Lite chart specification from numeric results returned by tpch_analyst."
    - tool_spec:
        type: "web_search"
        name: "web_search"
        description: "Searches the web for topics not covered by the TPC-H semantic view or Snowflake documentation."
    - tool_spec:
        type: "generic"
        name: "get_filings"
        description: "Retrieve filed context from this canvas — notes, decisions, learnings, and open threads that participants captured via /file during this session or any prior session on the same canvas. Call this whenever the user asks what has been filed, what the team decided, what notes exist, or anything about the saved history of this room."
        input_schema:
          type: "object"
          properties:
            canvas_id:
              type: "string"
              description: "The canvas id to retrieve filings for. Pass the value from the [canvas: ...] prefix on the user's message."
          required: ["canvas_id"]
    - tool_spec:
        type: "generic"
        name: "list_documents"
        description: "List the documents, slide decks, and artifacts in this canvas (id, kind, title, last editor)."
        input_schema:
          type: "object"
          properties:
            canvas_id:
              type: "string"
              description: "The canvas id from the [canvas: ...] prefix."
          required: ["canvas_id"]
    - tool_spec:
        type: "generic"
        name: "read_document"
        description: "Read the current content of one document in this canvas, as markdown (docs, slides), HTML, or Vega-Lite JSON."
        input_schema:
          type: "object"
          properties:
            canvas_id:
              type: "string"
              description: "The canvas id from the [canvas: ...] prefix."
            document:
              type: "string"
              description: "The document id or exact title."
          required: ["canvas_id", "document"]
    - tool_spec:
        type: "generic"
        name: "create_document"
        description: "Create a new document, slide deck, or artifact in the canvas. It opens live for every teammate."
        input_schema:
          type: "object"
          properties:
            canvas_id:
              type: "string"
              description: "The canvas id from the [canvas: ...] prefix."
            kind:
              type: "string"
              description: "One of: doc, slides, html, markdown, chart."
            title:
              type: "string"
              description: "A short title."
            content:
              type: "string"
              description: "Markdown for doc/slides/markdown (slides separated by a line with only ---), a complete HTML document for html, or a Vega-Lite JSON spec with inline data for chart."
          required: ["canvas_id", "kind", "title", "content"]
    - tool_spec:
        type: "generic"
        name: "edit_document"
        description: "Suggest an edit to an existing document. The change appears as a tracked suggestion attributed to Luke that teammates accept or reject."
        input_schema:
          type: "object"
          properties:
            canvas_id:
              type: "string"
              description: "The canvas id from the [canvas: ...] prefix."
            document:
              type: "string"
              description: "The document id or exact title."
            operation:
              type: "string"
              description: "replace (swap find_text for new_text), append (add new_text at the end), or prepend (add new_text at the start)."
            find_text:
              type: "string"
              description: "For replace: the exact text currently in the document. Empty for append/prepend."
            new_text:
              type: "string"
              description: "The new text, as markdown for doc/slides (plain text for a replace within a paragraph)."
          required: ["canvas_id", "document", "operation", "find_text", "new_text"]
    - tool_spec:
        type: "generic"
        name: "comment_on_document"
        description: "Leave a comment anchored to a quote in a document, as a reviewer would."
        input_schema:
          type: "object"
          properties:
            canvas_id:
              type: "string"
              description: "The canvas id from the [canvas: ...] prefix."
            document:
              type: "string"
              description: "The document id or exact title."
            quote:
              type: "string"
              description: "Exact text from the document to anchor the comment to."
            comment:
              type: "string"
              description: "The comment."
          required: ["canvas_id", "document", "quote", "comment"]
    - tool_spec:
        type: "generic"
        name: "describe_sandbox"
        description: "List every table in the writable AGENT_CANVAS_PLUS.SANDBOX schema with its column names and types. Call this before propose_sql so the statement uses real column names."
        input_schema:
          type: "object"
          properties: {}
    - tool_spec:
        type: "generic"
        name: "propose_sql"
        description: "Propose one Snowflake SQL statement that writes data or creates objects. It does NOT run: a teammate must approve it in the canvas first."
        input_schema:
          type: "object"
          properties:
            canvas_id:
              type: "string"
              description: "The canvas id from the [canvas: ...] prefix."
            sql_text:
              type: "string"
              description: "Exactly one SQL statement, fully qualified names."
            rationale:
              type: "string"
              description: "One line on what it does and why."
          required: ["canvas_id", "sql_text", "rationale"]
    - tool_spec:
        type: "code_execution"
        name: "code_execution"

  tool_resources:
    tpch_analyst:
      semantic_view: "AGENT_CANVAS_PLUS.AGENTS.TPCH_REV_SV"
      execution_environment:
        type: "warehouse"
        warehouse: "AGENT_CANVAS_PLUS_WH"
    docs_search:
      search_service: "SNOWFLAKE_DOCUMENTATION.SHARED.CKE_SNOWFLAKE_DOCS_SERVICE"
      max_results: "5"
      id_column: "SOURCE_URL"
    get_filings:
      identifier: "AGENT_CANVAS_PLUS.AGENTS.GET_FILINGS"
      type: "function"
      execution_environment:
        type: "warehouse"
        warehouse: "AGENT_CANVAS_PLUS_WH"
    list_documents:
      identifier: "AGENT_CANVAS_PLUS.AGENTS.LIST_DOCUMENTS"
      type: "function"
      execution_environment:
        type: "warehouse"
        warehouse: "AGENT_CANVAS_PLUS_WH"
    read_document:
      identifier: "AGENT_CANVAS_PLUS.AGENTS.READ_DOCUMENT"
      type: "function"
      execution_environment:
        type: "warehouse"
        warehouse: "AGENT_CANVAS_PLUS_WH"
    create_document:
      identifier: "AGENT_CANVAS_PLUS.AGENTS.CREATE_DOCUMENT"
      type: "procedure"
      execution_environment:
        type: "warehouse"
        warehouse: "AGENT_CANVAS_PLUS_WH"
    edit_document:
      identifier: "AGENT_CANVAS_PLUS.AGENTS.EDIT_DOCUMENT"
      type: "procedure"
      execution_environment:
        type: "warehouse"
        warehouse: "AGENT_CANVAS_PLUS_WH"
    comment_on_document:
      identifier: "AGENT_CANVAS_PLUS.AGENTS.COMMENT_ON_DOCUMENT"
      type: "procedure"
      execution_environment:
        type: "warehouse"
        warehouse: "AGENT_CANVAS_PLUS_WH"
    describe_sandbox:
      identifier: "AGENT_CANVAS_PLUS.AGENTS.DESCRIBE_SANDBOX"
      type: "procedure"
      execution_environment:
        type: "warehouse"
        warehouse: "AGENT_CANVAS_PLUS_WH"
    propose_sql:
      identifier: "AGENT_CANVAS_PLUS.AGENTS.PROPOSE_SQL"
      type: "procedure"
      execution_environment:
        type: "warehouse"
        warehouse: "AGENT_CANVAS_PLUS_WH"
    code_execution:
      permission_policy:
        type: "always_ask"
  $$;

-- -----------------------------------------------------------------------------
-- 6. Grants on AGENT_CANVAS_PLUS_ROLE
-- -----------------------------------------------------------------------------
GRANT USAGE ON DATABASE AGENT_CANVAS_PLUS TO ROLE AGENT_CANVAS_PLUS_ROLE;
GRANT USAGE ON SCHEMA AGENT_CANVAS_PLUS.AGENTS TO ROLE AGENT_CANVAS_PLUS_ROLE;
GRANT USAGE ON SCHEMA AGENT_CANVAS_PLUS.PUBLIC TO ROLE AGENT_CANVAS_PLUS_ROLE;

GRANT USAGE ON WAREHOUSE AGENT_CANVAS_PLUS_WH TO ROLE AGENT_CANVAS_PLUS_ROLE;

GRANT USAGE ON AGENT AGENT_CANVAS_PLUS.AGENTS.CANVAS_AGENT TO ROLE AGENT_CANVAS_PLUS_ROLE;
GRANT SELECT, REFERENCES ON SEMANTIC VIEW AGENT_CANVAS_PLUS.AGENTS.TPCH_REV_SV TO ROLE AGENT_CANVAS_PLUS_ROLE;
GRANT USAGE ON FUNCTION AGENT_CANVAS_PLUS.AGENTS.GET_FILINGS(STRING) TO ROLE AGENT_CANVAS_PLUS_ROLE;
GRANT USAGE ON FUNCTION AGENT_CANVAS_PLUS.AGENTS.LIST_DOCUMENTS(STRING) TO ROLE AGENT_CANVAS_PLUS_ROLE;
GRANT USAGE ON FUNCTION AGENT_CANVAS_PLUS.AGENTS.READ_DOCUMENT(STRING, STRING) TO ROLE AGENT_CANVAS_PLUS_ROLE;
GRANT USAGE ON PROCEDURE AGENT_CANVAS_PLUS.AGENTS.CREATE_DOCUMENT(STRING, STRING, STRING, STRING) TO ROLE AGENT_CANVAS_PLUS_ROLE;
GRANT USAGE ON PROCEDURE AGENT_CANVAS_PLUS.AGENTS.EDIT_DOCUMENT(STRING, STRING, STRING, STRING, STRING) TO ROLE AGENT_CANVAS_PLUS_ROLE;
GRANT USAGE ON PROCEDURE AGENT_CANVAS_PLUS.AGENTS.COMMENT_ON_DOCUMENT(STRING, STRING, STRING, STRING) TO ROLE AGENT_CANVAS_PLUS_ROLE;
GRANT USAGE ON PROCEDURE AGENT_CANVAS_PLUS.AGENTS.PROPOSE_SQL(STRING, STRING, STRING) TO ROLE AGENT_CANVAS_PLUS_ROLE;
GRANT USAGE ON PROCEDURE AGENT_CANVAS_PLUS.AGENTS.DESCRIBE_SANDBOX() TO ROLE AGENT_CANVAS_PLUS_ROLE;

-- Canvas Plus tables (app plumbing: the app reads and writes these)
GRANT SELECT, INSERT, UPDATE ON TABLE AGENT_CANVAS_PLUS.PUBLIC.DOCS TO ROLE AGENT_CANVAS_PLUS_ROLE;
GRANT SELECT, INSERT ON TABLE AGENT_CANVAS_PLUS.PUBLIC.DOC_VERSIONS TO ROLE AGENT_CANVAS_PLUS_ROLE;
GRANT SELECT, INSERT, UPDATE ON TABLE AGENT_CANVAS_PLUS.PUBLIC.COMMENTS TO ROLE AGENT_CANVAS_PLUS_ROLE;
GRANT SELECT, INSERT, UPDATE ON TABLE AGENT_CANVAS_PLUS.PUBLIC.PENDING_ACTIONS TO ROLE AGENT_CANVAS_PLUS_ROLE;
GRANT SELECT ON TABLE AGENT_CANVAS_PLUS.PUBLIC.AI_OPS TO ROLE AGENT_CANVAS_PLUS_ROLE;

-- Approved SQL runs under the approving teammate's role when deployed
-- (caller's rights). In local dev it runs under the connection's role.
-- SANDBOX is open to the app role for the demo targets table.
GRANT USAGE ON SCHEMA AGENT_CANVAS_PLUS.SANDBOX TO ROLE AGENT_CANVAS_PLUS_ROLE;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA AGENT_CANVAS_PLUS.SANDBOX TO ROLE AGENT_CANVAS_PLUS_ROLE;
GRANT CREATE TABLE ON SCHEMA AGENT_CANVAS_PLUS.SANDBOX TO ROLE AGENT_CANVAS_PLUS_ROLE;
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE AGENT_CANVAS_PLUS_ROLE;

-- TPC-H sample data (read-only, inbound share)
GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE_SAMPLE_DATA TO ROLE AGENT_CANVAS_PLUS_ROLE;

-- Snowflake Documentation CKE (read-only, inbound share)
GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE_DOCUMENTATION TO ROLE AGENT_CANVAS_PLUS_ROLE;

-- CANVASES table (read-write — the app writes thread IDs here)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE AGENT_CANVAS_PLUS.PUBLIC.CANVASES
  TO ROLE AGENT_CANVAS_PLUS_ROLE;

-- CANVAS_CONTEXT table (append-only — the app writes /file submissions here)
GRANT SELECT, INSERT ON TABLE AGENT_CANVAS_PLUS.PUBLIC.CANVAS_CONTEXT
  TO ROLE AGENT_CANVAS_PLUS_ROLE;

-- Grant AGENT_CANVAS_PLUS_ROLE to ACCOUNTADMIN so the SPCS service's inherited
-- role chain can downgrade to it via the X-Snowflake-Role header.
GRANT ROLE AGENT_CANVAS_PLUS_ROLE TO ROLE ACCOUNTADMIN;

-- -----------------------------------------------------------------------------
-- 7. Sanity checks (optional — uncomment to verify)
-- -----------------------------------------------------------------------------
-- SHOW DATABASES LIKE 'AGENT_CANVAS_PLUS';
-- SHOW DATABASES LIKE 'SNOWFLAKE_DOCUMENTATION';
-- SHOW WAREHOUSES LIKE 'AGENT_CANVAS_PLUS_WH';
-- SHOW ROLES LIKE 'AGENT_CANVAS_PLUS_ROLE';
-- SHOW SEMANTIC VIEWS IN SCHEMA AGENT_CANVAS_PLUS.AGENTS;
-- SHOW AGENTS IN SCHEMA AGENT_CANVAS_PLUS.AGENTS;
-- SELECT COUNT(*) FROM AGENT_CANVAS_PLUS.PUBLIC.CANVASES;
--
-- SELECT * FROM SEMANTIC_VIEW(
--   AGENT_CANVAS_PLUS.AGENTS.TPCH_REV_SV
--   METRICS line_items.total_revenue
--   DIMENSIONS regions.region_name
-- ) ORDER BY total_revenue DESC;

-- =============================================================================
-- Setup complete. Next:
--   snow app deploy
-- =============================================================================
