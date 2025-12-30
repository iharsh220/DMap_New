/**
 * Client-side Socket.IO connection example for email verification
 *
 * This shows how to connect to the Socket.IO namespace and listen for verification events
 * with proper user association to ensure events are targeted to the correct user.
 */

// Connect to the Socket.IO server with the correct namespace
const socket = io('https://alembicdigilabs.in/digilabs/dmap/api/socket', {
    path: '/socket.io',
    transports: ['websocket'],
    reconnection: true,
    withCredentials: true
});

// Listen for connection events
socket.on('connect', () => {
    console.log('✅ Connected to Socket.IO namespace:', socket.nsp);
    console.log('Socket ID:', socket.id);

    // IMPORTANT: Associate this socket with the current user
    // This should be called after the user is authenticated/logged in
    const userId = 'current-user-email@example.com'; // Replace with actual user email
    if (userId) {
        socket.emit('associateUser', userId);
        console.log(`🔗 Associated socket ${socket.id} with user ${userId}`);
    }
});

socket.on('connect_error', (error) => {
    console.log('❌ Connection error:', error.message);
});

socket.on('disconnect', (reason) => {
    console.log('⚠️ Disconnected:', reason);
});

// Listen for email verification events
socket.on('emailVerified', (data) => {
    console.log('📧 Email Verification Success:', data);
    // Handle successful email verification
    if (data.success) {
        alert(`Email verified successfully! ${data.message}`);
        // You can redirect to registration completion page here
        // window.location.href = '/complete-registration';
    }
});

socket.on('verificationError', (data) => {
    console.log('❌ Email Verification Error:', data);
    // Handle verification errors
    alert(`Verification failed: ${data.message}`);
    // You can redirect based on the error type
    if (data.action === 'initiate_registration') {
        // window.location.href = '/register';
    } else if (data.action === 'login') {
        // window.location.href = '/login';
    }
});

// Example: Call email verification API
async function verifyEmail(token) {
    try {
        const response = await fetch(`https://alembicdigilabs.in/digilabs/dmap/api/auth/verify-email?token=${token}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include'
        });

        const result = await response.json();

        if (result.success) {
            console.log('API Response:', result);
            // The Socket.IO event should have been triggered by the server
            // and should only be received by this specific user's socket
        } else {
            console.log('Verification failed:', result.error);
            alert(result.error);
        }
    } catch (error) {
        console.error('Error verifying email:', error);
        alert('An error occurred during email verification');
    }
}

// Usage example:
// 1. First establish socket connection and associate user
// 2. Then call verifyEmail('your-verification-token-here');