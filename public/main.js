const socket = new WebSocket(`ws://${window.location.host}`);

socket.onmessage = (event) => {
    document.getElementById('output').innerHTML += `<p>${event.data}</p>`;
};

function sendMessage() {
    socket.send('Hello from the browser!');
}