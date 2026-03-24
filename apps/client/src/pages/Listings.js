import React, { useState, useEffect, useRef } from "react";
import ListingCard from "../components/ListingCard";
import axios from "axios";

const BASE_URL = process.env.baseURL ?? 'http://localhost:5050';

const Listings = () => {
    const [listings, setListings] = useState([]);
    const [makesWithModels, setMakesWithModels] = useState({});
    const [categories, setCategories] = useState([]);
    const [positions, setPositions] = useState([]);
    const [constraints, setConstraints] = useState([]);
    const [years, setYears] = useState([]);
    const [isSearchFitment, setIsSearchByFitment] = useState(true);

    const [selectedFitment, setSelectedFitment] = useState({
        make: '', model: '', year: undefined,
        category: undefined, position: undefined, constraint: undefined
    });
    const [selectedPartNumber, setSelectedPartNumber] = useState({ partNumber: '', year: undefined });

    // pagination state
    const [cursor, setCursor] = useState(null);
    const [hasMore, setHasMore] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    // track the last submitted search so "load more" can repeat it
    const lastSearchRef = useRef(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [makesWithModels, years, categories, positions, constraints] = await Promise.all([
                    axios.get(`${BASE_URL}/fitments/makes-with-models`),
                    axios.get(`${BASE_URL}/fitments/years`),
                    axios.get(`${BASE_URL}/fitments/categories`),
                    axios.get(`${BASE_URL}/fitments/positions`),
                    axios.get(`${BASE_URL}/fitments/constraints`)
                ]);
                setMakesWithModels(makesWithModels.data);
                setYears(years.data);
                setCategories(categories.data);
                setPositions(positions.data);
                setConstraints(constraints.data);
            } catch (error) {
                console.error('Error fetching fitment data:', error);
            }
        };
        fetchData();
    }, []);

    const fetchListingsByFitment = async (params, append = false) => {
        setIsLoading(true);
        try {
            const { data } = await axios.get(`${BASE_URL}/listings/by-fitment`, { params });
            setListings(prev => append ? [...prev, ...data.listings] : data.listings);
            setCursor(data.cursor);
            setHasMore(data.hasMore);
        } catch (err) {
            console.error('Error searching by fitment:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchListingsByPartNumber = async (params, append = false) => {
        setIsLoading(true);
        try {
            const { data } = await axios.get(`${BASE_URL}/listings/by-part-number/${params.partNumber}`, {
                params: { cursor: params.cursor }
            });
            setListings(prev => append ? [...prev, ...data.listings] : data.listings);
            setCursor(data.cursor);
            setHasMore(data.hasMore);
        } catch (err) {
            console.error('Error searching by part number:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSearchByFitment = (e) => {
        e.preventDefault();
        const params = { ...selectedFitment };
        lastSearchRef.current = { type: 'fitment', params };
        setCursor(null);
        fetchListingsByFitment(params, false);
    };

    const handleSearchByPartNumber = (e) => {
        e.preventDefault();
        const params = { partNumber: selectedPartNumber.partNumber };
        lastSearchRef.current = { type: 'partNumber', params };
        setCursor(null);
        fetchListingsByPartNumber(params, false);
    };

    const handleLoadMore = () => {
        if (!lastSearchRef.current || !cursor) return;
        const { type, params } = lastSearchRef.current;
        const paramsWithCursor = { ...params, cursor };
        if (type === 'fitment') fetchListingsByFitment(paramsWithCursor, true);
        else fetchListingsByPartNumber(paramsWithCursor, true);
    };

    return (
        <div>
            <div>
                <button onClick={() => setIsSearchByFitment(true)} disabled={isSearchFitment}>Search by Fitment</button>
                <button onClick={() => setIsSearchByFitment(false)} disabled={!isSearchFitment}>Search by Part Number</button>
            </div>

            {isSearchFitment ? (
                <form onSubmit={handleSearchByFitment}>
                    <select value={selectedFitment.make} onChange={(e) => setSelectedFitment({ ...selectedFitment, make: e.target.value })}>
                        <option value=''>Select a make</option>
                        {Object.keys(makesWithModels).map(make => <option key={make} value={make}>{make}</option>)}
                    </select>
                    <select value={selectedFitment.model} disabled={!selectedFitment.make} onChange={(e) => setSelectedFitment({ ...selectedFitment, model: e.target.value })}>
                        <option value=''>{selectedFitment.make ? 'Select a model' : 'Select a make first'}</option>
                        {makesWithModels[selectedFitment.make]?.map(model => <option key={model} value={model}>{model}</option>)}
                    </select>
                    <select value={selectedFitment.year ?? ""} onChange={(e) => setSelectedFitment({ ...selectedFitment, year: e.target.value })}>
                        <option value=''>Select a year</option>
                        {years.map(year => <option key={year} value={year}>{year}</option>)}
                    </select>
                    <select value={selectedFitment.category ?? ""} onChange={(e) => setSelectedFitment({ ...selectedFitment, category: e.target.value })}>
                        <option value=''>Select a category</option>
                        {categories.map(category => <option key={category} value={category}>{category}</option>)}
                    </select>
                    <select value={selectedFitment.position ?? ""} onChange={(e) => setSelectedFitment({ ...selectedFitment, position: e.target.value })}>
                        <option value=''>Select a position</option>
                        {positions.map(position => <option key={position} value={position}>{position}</option>)}
                    </select>
                    <select value={selectedFitment.constraint ?? ""} onChange={(e) => setSelectedFitment({ ...selectedFitment, constraint: e.target.value })}>
                        <option value=''>Select a constraint</option>
                        {constraints.map(constraint => <option key={constraint} value={constraint}>{constraint}</option>)}
                    </select>
                    <button type="submit" disabled={isLoading || (!selectedFitment.make && !selectedFitment.model && !selectedFitment.year)}>
                        {isLoading ? 'Searching...' : 'Search'}
                    </button>
                </form>
            ) : (
                <form onSubmit={handleSearchByPartNumber}>
                    <label>Part Number: </label>
                    <input
                        type="text"
                        value={selectedPartNumber.partNumber}
                        onChange={(e) => setSelectedPartNumber({ ...selectedPartNumber, partNumber: e.target.value })}
                    />
                    <button type="submit" disabled={isLoading || !selectedPartNumber.partNumber.length}>
                        {isLoading ? 'Searching...' : 'Search'}
                    </button>
                </form>
            )}

            <div>
                {listings.map(listing => (
                    <ListingCard key={listing.id} listing={listing} onClick={() => {}} />
                ))}
            </div>

            {hasMore && (
                <button onClick={handleLoadMore} disabled={isLoading}>
                    {isLoading ? 'Loading...' : 'Load More'}
                </button>
            )}
        </div>
    );
};

export default Listings;