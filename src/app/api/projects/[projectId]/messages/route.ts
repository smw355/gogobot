import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { verifySession } from '@/lib/auth/verify-session';

// GET /api/projects/[projectId]/messages - Get all messages for a project
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const user = await verifySession();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;
    const db = getAdminDb();

    // Verify project ownership
    const projectDoc = await db.collection('projects').doc(projectId).get();
    if (!projectDoc.exists || projectDoc.data()?.userId !== user.uid) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get messages
    const messagesSnapshot = await db
      .collection('projects')
      .doc(projectId)
      .collection('messages')
      .orderBy('timestamp', 'asc')
      .get();

    const messages = messagesSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate(),
    }));

    return NextResponse.json({ messages });
  } catch (error: any) {
    console.error('Get messages error:', error);
    return NextResponse.json({ error: error.message || 'Failed to get messages' }, { status: 500 });
  }
}

// POST /api/projects/[projectId]/messages - Save a message
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const user = await verifySession();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;
    const { message } = await request.json();
    const db = getAdminDb();

    // Verify project ownership
    const projectDoc = await db.collection('projects').doc(projectId).get();
    if (!projectDoc.exists || projectDoc.data()?.userId !== user.uid) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Save message
    await db
      .collection('projects')
      .doc(projectId)
      .collection('messages')
      .doc(message.id)
      .set({
        ...message,
        timestamp: new Date(message.timestamp),
      });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Save message error:', error);
    return NextResponse.json({ error: error.message || 'Failed to save message' }, { status: 500 });
  }
}

// DELETE /api/projects/[projectId]/messages - Delete all messages
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const user = await verifySession();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await params;
    const db = getAdminDb();

    // Verify project ownership
    const projectDoc = await db.collection('projects').doc(projectId).get();
    if (!projectDoc.exists || projectDoc.data()?.userId !== user.uid) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Delete all messages
    const messagesSnapshot = await db
      .collection('projects')
      .doc(projectId)
      .collection('messages')
      .get();

    const batch = db.batch();
    messagesSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete messages error:', error);
    return NextResponse.json({ error: error.message || 'Failed to delete messages' }, { status: 500 });
  }
}
