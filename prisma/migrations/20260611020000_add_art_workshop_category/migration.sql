-- Add ART_WORKSHOP to the EventCategory enum.
-- Hands-on art/craft sessions (painting, paint-and-sip, block printing,
-- ceramics, etc.) previously scattered across ART_PERFORMANCE / COMMUNITY /
-- FAMILY; this gives them a dedicated home. TRIVIA_BINGO is unchanged at the
-- DB level — only its display label was broadened to "Games & Trivia".
ALTER TYPE "EventCategory" ADD VALUE 'ART_WORKSHOP';
