import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const { name, email, eventName, eventDate, eventUrl, message } = await req.json();

  if (!name?.trim() || !email?.trim() || !eventName?.trim() || !message?.trim()) {
    return NextResponse.json(
      { error: "name, email, eventName, and message are required" },
      { status: 400 }
    );
  }

  await prisma.featuredRequest.create({
    data: {
      name: name.trim(),
      email: email.trim(),
      eventName: eventName.trim(),
      eventDate: eventDate?.trim() || null,
      eventUrl: eventUrl?.trim() || null,
      message: message.trim(),
    },
  });

  return NextResponse.json({ success: true });
}
