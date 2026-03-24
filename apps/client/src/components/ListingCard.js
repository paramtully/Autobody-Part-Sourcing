import React, { useNavigate } from 'react';

const ListingCard = ({ listing }) => {
    const navigate = useNavigate();

    const handleClick = () => {
        navigate(`/listings/${listing.id}`, { state: { listing } });
    };

    return (
        <div>
            <p><span>Part Number: </span> {listing.partNumber}</p>
            <p><span>Part Type: </span> {listing.type}</p>
            <p><span>Manufacturer: </span> {listing.manufacturer}</p>
            <p><span>Certification: </span> {listing.certification}</p>
            <p><span>Condition: </span> {listing.condition}</p>
            <p><span>Quantity Available: </span> {listing.quantityAvailable}</p>
            <p><span>Price: </span> $ {listing.priceMinorMin} - {listing.priceMinorMax} {listing.currency}</p>
            <p><span>Estimated Ship Time: </span> {listing.estimatedShipTimeHours}</p>
            <button onClick={handleClick}>View Part</button>
        </div>
    );
}

export default ListingCard;